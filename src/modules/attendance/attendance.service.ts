import { Injectable, Logger, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; // Adjust path if needed
import { CheckInDto, CheckOutDto, StartBreakDto, EndBreakDto } from './dto/attendance.dto';
import { differenceInMinutes, startOfDay, endOfDay } from 'date-fns';

@Injectable()
export class AttendanceService {
    private readonly logger = new Logger(AttendanceService.name);

    constructor(private readonly prisma: PrismaService) { }

    async checkIn(orgId: string, userId: string, dto: CheckInDto) {
        const activeSession = await this.prisma.attendanceSession.findFirst({
            where: { userId, orgId, checkOut: null },
        });
        if (activeSession) {
            throw new BadRequestException('You already have an active attendance session in this organization.');
        }

        return this.prisma.attendanceSession.create({
            data: {
                userId,
                orgId,
                workMode: dto.workMode,
                checkIn: new Date(),
            },
        });
    }

    async checkOut(orgId: string, userId: string, dto: CheckOutDto) {
        const session = await this.prisma.attendanceSession.findFirst({
            where: { userId, orgId, checkOut: null },
        });
        if (!session) {
            throw new NotFoundException('No active attendance session found to check out.');
        }

        // Ensure any active break is ended first
        const activeBreak = await this.prisma.attendanceBreak.findFirst({
            where: { sessionId: session.id, endTime: null },
        });
        if (activeBreak) {
            await this.prisma.attendanceBreak.update({
                where: { id: activeBreak.id },
                data: { endTime: new Date() },
            });
        }

        const checkOut = new Date();
        // Calculate total minutes.
        // get all breaks for this session to subtract break time? The rules do not specify if totalMinutes excludes break time.
        // Generally totalMinutes = (checkOut - checkIn) - total_break_time
        const allBreaks = await this.prisma.attendanceBreak.findMany({
            where: { sessionId: session.id },
        });

        let breakMinutes = 0;
        for (const b of allBreaks) {
            const end = b.endTime || checkOut;
            breakMinutes += differenceInMinutes(end, b.startTime);
        }

        const grossMinutes = differenceInMinutes(checkOut, session.checkIn);
        const totalMinutes = Math.max(0, grossMinutes - breakMinutes);

        return this.prisma.attendanceSession.update({
            where: { id: session.id },
            data: {
                checkOut,
                totalMinutes,
            },
        });
    }

    async startBreak(orgId: string, userId: string, dto: StartBreakDto) {
        const session = await this.prisma.attendanceSession.findFirst({
            where: { userId, orgId, checkOut: null },
        });
        if (!session) {
            throw new NotFoundException('No active attendance session found.');
        }

        const activeBreak = await this.prisma.attendanceBreak.findFirst({
            where: { sessionId: session.id, endTime: null },
        });
        if (activeBreak) {
            throw new BadRequestException('A break is already active in this session.');
        }

        return this.prisma.attendanceBreak.create({
            data: {
                sessionId: session.id,
                type: dto.type,
                startTime: new Date(),
            },
        });
    }

    async endBreak(orgId: string, userId: string, dto: EndBreakDto) {
        const session = await this.prisma.attendanceSession.findFirst({
            where: { userId, orgId, checkOut: null },
        });
        if (!session) {
            throw new NotFoundException('No active attendance session found.');
        }

        const activeBreak = await this.prisma.attendanceBreak.findFirst({
            where: { sessionId: session.id, endTime: null },
        });
        if (!activeBreak) {
            throw new BadRequestException('No active break found to end.');
        }

        return this.prisma.attendanceBreak.update({
            where: { id: activeBreak.id },
            data: {
                endTime: new Date(),
            },
        });
    }

    /**
     * Get today's attendance session for (userId + orgId). Uses request.orgId only; no cross-org.
     * Returns session + activeBreak if any, or null when none.
     */
    async getTodaySession(orgId: string, userId: string) {
        const now = new Date();
        const start = startOfDay(now);
        const end = endOfDay(now);
        const session = await this.prisma.attendanceSession.findFirst({
            where: {
                userId,
                orgId,
                checkIn: { gte: start, lte: end },
            },
            orderBy: { checkIn: 'desc' },
        });
        if (!session) return null;
        const activeBreak = await this.prisma.attendanceBreak.findFirst({
            where: { sessionId: session.id, endTime: null },
        });
        return {
            session: {
                id: session.id,
                orgId: session.orgId,
                checkIn: session.checkIn,
                checkOut: session.checkOut,
                workMode: session.workMode,
                totalMinutes: session.totalMinutes,
            },
            activeBreak: activeBreak
                ? { id: activeBreak.id, type: activeBreak.type, startTime: activeBreak.startTime }
                : null,
            status: session.checkOut ? 'checked_out' as const : activeBreak ? 'on_break' as const : 'checked_in' as const,
        };
    }

    /**
     * Get current attendance status for a user in the given org.
     * Used for "my status" (GET /attendance/me) and "another user's status" (GET /attendance/users/:userId).
     * All queries use userId + orgId (request.orgId); never userId only.
     */
    async getCurrentAttendance(orgId: string, userId: string) {
        const session = await this.prisma.attendanceSession.findFirst({
            where: { userId, orgId, checkOut: null },
            orderBy: { checkIn: 'desc' },
        });
        if (!session) {
            return {
                userId,
                status: 'checked_out' as const,
                session: null,
                activeBreak: null,
            };
        }
        const activeBreak = await this.prisma.attendanceBreak.findFirst({
            where: { sessionId: session.id, endTime: null },
        });
        return {
            userId,
            status: activeBreak ? ('on_break' as const) : ('checked_in' as const),
            session: {
                id: session.id,
                orgId: session.orgId,
                checkIn: session.checkIn,
                workMode: session.workMode,
            },
            activeBreak: activeBreak
                ? {
                    id: activeBreak.id,
                    type: activeBreak.type,
                    startTime: activeBreak.startTime,
                }
                : null,
        };
    }

    /**
     * Get another user's current attendance in this org. Caller must be in same org (enforced by OrgGuard + membership check).
     */
    async getUserAttendance(orgId: string, requesterUserId: string, targetUserId: string) {
        const targetMember = await this.prisma.orgMember.findFirst({
            where: { orgId, userId: targetUserId, isActive: true },
        });
        if (!targetMember) {
            throw new NotFoundException('User not found in this organization.');
        }
        return this.getCurrentAttendance(orgId, targetUserId);
    }
}

