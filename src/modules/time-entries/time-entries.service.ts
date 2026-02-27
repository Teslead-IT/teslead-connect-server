import { Injectable, Logger, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgSettingsService } from '../org-settings/org-settings.service';
import { CreateTimeEntryDto, UpdateTimeEntryDto } from './dto/time-entries.dto';

@Injectable()
export class TimeEntriesService {
    private readonly logger = new Logger(TimeEntriesService.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly orgSettings: OrgSettingsService,
    ) {}

    async create(orgId: string, userId: string, dto: CreateTimeEntryDto) {
        const settings = await this.orgSettings.getSettingsForEnforcement(orgId);
        if (!settings.allowManualTimeEntry) {
            throw new ForbiddenException('Manual time entries are not allowed for this organization.');
        }

        // Validate task belongs to org (project.orgId === orgId)
        const task = await this.prisma.task.findFirst({
            where: {
                id: dto.taskId,
                project: {
                    id: dto.projectId,
                    orgId,
                },
            },
        });
        if (!task) {
            throw new ForbiddenException('Task or project does not belong to this organization.');
        }

        // Overlap validation (scoped to org for consistency)
        if (dto.startTime && dto.endTime) {
            await this.validateOverlap(userId, orgId, new Date(dto.startTime), new Date(dto.endTime));
        }

        const timeEntry = await this.prisma.timeEntry.create({
            data: {
                userId,
                orgId,
                projectId: dto.projectId,
                phaseId: dto.phaseId,
                taskListId: dto.taskListId,
                taskId: dto.taskId,
                date: new Date(dto.date),
                durationMinutes: dto.durationMinutes,
                description: dto.description,
                billable: dto.billable !== undefined ? dto.billable : true,
                startTime: dto.startTime ? new Date(dto.startTime) : undefined,
                endTime: dto.endTime ? new Date(dto.endTime) : undefined,
            },
        });

        await this.upsertWeeklyTimesheet(orgId, userId, new Date(dto.date), dto.durationMinutes);

        return timeEntry;
    }

    async update(id: string, userId: string, orgId: string, dto: UpdateTimeEntryDto) {
        const existing = await this.prisma.timeEntry.findFirst({
            where: {
                id,
                userId,
                orgId,
            },
        });

        if (!existing) {
            throw new ForbiddenException('Time entry not found or access denied.');
        }

        await this.assertTimesheetNotLocked(orgId, userId, existing.date);

        // Overlap Validation if times are updated
        const newStartTime = dto.startTime ? new Date(dto.startTime) : existing.startTime;
        const newEndTime = dto.endTime ? new Date(dto.endTime) : existing.endTime;

        if (newStartTime && newEndTime) {
            await this.validateOverlap(userId, orgId, newStartTime, newEndTime, id);
        }

        const updated = await this.prisma.timeEntry.update({
            where: { id: existing.id },
            data: {
                durationMinutes: dto.durationMinutes,
                description: dto.description,
                billable: dto.billable,
                startTime: dto.startTime ? new Date(dto.startTime) : undefined,
                endTime: dto.endTime ? new Date(dto.endTime) : undefined,
            },
        });

        // Update Timesheet diff if duration changed
        if (dto.durationMinutes !== undefined && dto.durationMinutes !== existing.durationMinutes) {
            const diff = dto.durationMinutes - existing.durationMinutes;
            await this.upsertWeeklyTimesheet(existing.orgId, userId, existing.date, diff);
        }

        return updated;
    }

    async remove(id: string, userId: string, orgId: string) {
        const existing = await this.prisma.timeEntry.findFirst({
            where: {
                id,
                userId,
                orgId,
            },
        });

        if (!existing) {
            throw new ForbiddenException('Time entry not found or access denied.');
        }

        await this.assertTimesheetNotLocked(orgId, userId, existing.date);

        await this.prisma.timeEntry.delete({
            where: { id: existing.id },
        });

        // Subtract from weekly timesheet
        await this.upsertWeeklyTimesheet(existing.orgId, userId, existing.date, -existing.durationMinutes);

        return { message: 'Time entry deleted' };
    }

    async findAll(orgId: string, userId: string, date?: string) {
        const whereClause: any = { orgId, userId };
        if (date) {
            const targetDate = new Date(date);
            // Depending on exact precision needs, might need a date range query
            // For exact date matching:
            whereClause.date = targetDate;
        }

        return this.prisma.timeEntry.findMany({
            where: whereClause,
            orderBy: { date: 'desc' },
        });
    }

    /**
     * Overlap validation scoped to org for this user.
     */
    private async validateOverlap(userId: string, orgId: string, start: Date, end: Date, excludeId?: string) {
        if (start >= end) {
            throw new BadRequestException('startTime must be before endTime');
        }

        const whereClause: any = {
            userId,
            orgId,
            startTime: { not: null },
            endTime: { not: null },
            OR: [
                {
                    startTime: { lt: end },
                    endTime: { gt: start },
                },
            ],
        };

        if (excludeId) {
            whereClause.id = { not: excludeId };
        }

        const overlapping = await this.prisma.timeEntry.findFirst({
            where: whereClause,
        });

        if (overlapping) {
            throw new BadRequestException('Time entry overlaps with an existing entry.');
        }
    }

    /** Throw if org has lockTimesheetAfterApproval and the week's timesheet is approved */
    private async assertTimesheetNotLocked(orgId: string, userId: string, date: Date) {
        const settings = await this.orgSettings.getSettingsForEnforcement(orgId);
        if (!settings.lockTimesheetAfterApproval) return;
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);
        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: { orgId, userId, weekStart },
            },
            select: { status: true },
        });
        if (timesheet?.status === 'APPROVED') {
            throw new ForbiddenException('Cannot edit or delete time entries for an approved timesheet.');
        }
    }

    private async upsertWeeklyTimesheet(orgId: string, userId: string, date: Date, minutesToAdd: number) {
        const d = new Date(date);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        weekStart.setHours(0, 0, 0, 0);

        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);

        const timesheet = await this.prisma.weeklyTimesheet.findUnique({
            where: {
                orgId_userId_weekStart: {
                    orgId,
                    userId,
                    weekStart,
                },
            },
        });

        if (timesheet) {
            return this.prisma.weeklyTimesheet.update({
                where: { id: timesheet.id },
                data: {
                    totalMinutes: timesheet.totalMinutes + minutesToAdd,
                },
            });
        } else {
            return this.prisma.weeklyTimesheet.create({
                data: {
                    orgId,
                    userId,
                    weekStart,
                    weekEnd,
                    totalMinutes: minutesToAdd,
                },
            });
        }
    }
}

