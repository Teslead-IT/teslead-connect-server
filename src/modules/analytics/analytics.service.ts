import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
    OrgDashboardAnalyticsDto,
    MineDashboardAnalyticsDto,
    ChartDataPointDto,
    TimeSeriesPointDto,
    AnalyticsOverviewDto,
} from './dto/chart-data.dto';
import type { TaskListItemDto, TaskListResponseDto, ProjectListItemDto } from './dto/task-list-query.dto';
import type { OrgUserListItemDto, OrgUsersResponseDto } from './dto/org-users.dto';

const PRIORITY_LABELS: Record<number, string> = {
    0: 'Low',
    1: 'Medium',
    2: 'High',
    3: 'Urgent',
};

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly prisma: PrismaService) {}

    /**
     * Org-level dashboard analytics (all projects/tasks in the org)
     * For pie, bar, and line chart data
     */
    async getOrgDashboard(orgId: string): Promise<OrgDashboardAnalyticsDto> {
        this.logger.log(`Fetching org dashboard analytics for org ${orgId}`);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const sevenDaysLater = new Date(now);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);
        const thirtyDaysLater = new Date(now);
        thirtyDaysLater.setDate(thirtyDaysLater.getDate() + 30);

        // Projects in org
        const projects = await this.prisma.project.findMany({
            where: { orgId, isDeleted: false },
            select: {
                id: true,
                status: true,
                access: true,
                phases: {
                    where: { isDeleted: false },
                    select: { id: true, endDate: true },
                },
            },
        });

        // Tasks in org (via project)
        const projectIds = projects.map((p) => p.id);
        const tasks = await this.prisma.task.findMany({
            where: {
                projectId: { in: projectIds },
                isDeleted: false,
                parentId: null,
            },
            select: {
                id: true,
                statusId: true,
                priority: true,
                dueDate: true,
                status: { select: { name: true } },
                assignees: { select: { userId: true, user: { select: { name: true } } } },
            },
        });

        const totalPhases = projects.reduce((s, p) => s + p.phases.length, 0);
        const totalTaskLists = await this.prisma.taskList.count({
            where: { orgId, isDeleted: false },
        });

        const assignedUserIds = new Set<string>();
        tasks.forEach((t) => t.assignees.forEach((a) => assignedUserIds.add(a.userId)));

        const tasksWithDue = tasks.filter((t) => t.dueDate);
        const tasksOverdue = tasksWithDue.filter((t) => t.dueDate! < now).length;
        const tasksDueToday = tasksWithDue.filter(
            (t) => t.dueDate! >= todayStart && t.dueDate! < todayEnd,
        ).length;
        const tasksDueSoon = tasksWithDue.filter(
            (t) => t.dueDate! >= now && t.dueDate! <= sevenDaysLater,
        ).length;

        const allPhaseEndDates = projects.flatMap((p) =>
            p.phases.filter((ph) => ph.endDate).map((ph) => ph.endDate!),
        );
        const phasesEnded = allPhaseEndDates.filter((d) => d < now).length;
        const phasesEndingSoon = allPhaseEndDates.filter(
            (d) => d >= now && d <= thirtyDaysLater,
        ).length;

        const completedLike = (name: string) =>
            /done|complete/i.test(name || '');
        const tasksCompleted = tasks.filter((t) =>
            completedLike(t.status?.name || ''),
        ).length;
        const tasksPending = tasks.length - tasksCompleted;

        const overview: AnalyticsOverviewDto = {
            totalProjects: projects.length,
            totalTasks: tasks.length,
            totalPhases,
            totalTaskLists,
            assignedUsersCount: assignedUserIds.size,
            tasksOverdue,
            tasksDueSoon,
            tasksDueToday,
            phasesEnded,
            phasesEndingSoon,
            tasksCompleted,
            tasksPending,
        };

        const projectsByStatus = this.groupBy(projects, (p) => p.status, (s) =>
            String(s).replace(/_/g, ' '),
        );
        const projectsByAccess = this.groupBy(projects, (p) => p.access);

        const tasksByStatus = this.groupBy(
            tasks,
            (t) => t.status?.name || 'Unknown',
        );
        const tasksByPriority = this.groupBy(tasks, (t) => t.priority, (p) =>
            PRIORITY_LABELS[p] ?? `Priority ${p}`,
        );

        const assigneeCounts = new Map<string, number>();
        tasks.forEach((t) => {
            t.assignees.forEach((a) => {
                const name = (a.user as { name?: string })?.name || 'Unnamed';
                assigneeCounts.set(name, (assigneeCounts.get(name) || 0) + 1);
            });
        });
        const tasksByAssignee: ChartDataPointDto[] = Array.from(
            assigneeCounts.entries(),
        )
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10);

        const dueOverdue = tasksWithDue.filter((t) => t.dueDate! < now).length;
        const dueToday = tasksDueToday;
        const dueSoon = tasksWithDue.filter(
            (t) =>
                t.dueDate! >= now &&
                t.dueDate! <= sevenDaysLater &&
                (t.dueDate! < todayStart || t.dueDate! >= todayEnd),
        ).length;
        const dueLater = tasksWithDue.filter((t) => t.dueDate! > sevenDaysLater).length;
        const noDue = tasks.length - tasksWithDue.length;
        const tasksByDueBucket: ChartDataPointDto[] = [
            { label: 'Overdue', value: dueOverdue },
            { label: 'Today', value: dueToday },
            { label: 'Next 7 days', value: dueSoon },
            { label: 'Later', value: dueLater },
            { label: 'No due date', value: noDue },
        ].filter((d) => d.value > 0);

        const phaseEndingsByMonth = this.buildPhaseEndingsByMonth(
            allPhaseEndDates,
            now,
        );
        const taskDueCountByWeek = this.buildTaskDueByWeek(
            tasksWithDue.map((t) => t.dueDate!),
            now,
        );

        return {
            overview,
            projectsByStatus,
            projectsByAccess,
            tasksByStatus,
            tasksByPriority,
            tasksByAssignee,
            tasksByDueBucket,
            phaseEndingsByMonth,
            taskDueCountByWeek,
        };
    }

    /**
     * User-level "mine" dashboard within the org (my assigned tasks, my projects)
     */
    async getMineDashboard(
        orgId: string,
        userId: string,
    ): Promise<MineDashboardAnalyticsDto> {
        this.logger.log(`Fetching mine dashboard for user ${userId} in org ${orgId}`);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const sevenDaysLater = new Date(now);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const myProjects = await this.prisma.projectMember.findMany({
            where: {
                userId,
                isActive: true,
                project: { orgId, isDeleted: false },
            },
            select: { projectId: true },
        });
        const myProjectIds = myProjects.map((p) => p.projectId);

        const myTasks = await this.prisma.task.findMany({
            where: {
                projectId: { in: myProjectIds },
                isDeleted: false,
                parentId: null,
                assignees: { some: { userId } },
            },
            select: {
                id: true,
                statusId: true,
                priority: true,
                dueDate: true,
                projectId: true,
                status: { select: { name: true } },
                project: { select: { name: true } },
            },
        });

        const tasksWithDue = myTasks.filter((t) => t.dueDate);
        const myTasksOverdue = tasksWithDue.filter((t) => t.dueDate! < now).length;
        const myTasksDueToday = tasksWithDue.filter(
            (t) => t.dueDate! >= todayStart && t.dueDate! < todayEnd,
        ).length;
        const myTasksDueSoon = tasksWithDue.filter(
            (t) => t.dueDate! >= now && t.dueDate! <= sevenDaysLater,
        ).length;

        const completedLike = (name: string) =>
            /done|complete/i.test(name || '');
        const myTasksCompleted = myTasks.filter((t) =>
            completedLike(t.status?.name || ''),
        ).length;
        const myTasksPending = myTasks.length - myTasksCompleted;

        const myTasksByStatus = this.groupBy(
            myTasks,
            (t) => t.status?.name || 'Unknown',
        );
        const myTasksByPriority = this.groupBy(myTasks, (t) => t.priority, (p) =>
            PRIORITY_LABELS[p] ?? `Priority ${p}`,
        );

        const dueOverdue = myTasks.filter((t) => t.dueDate && t.dueDate < now).length;
        const dueToday = myTasksDueToday;
        const dueSoon = myTasks.filter(
            (t) =>
                t.dueDate &&
                t.dueDate >= now &&
                t.dueDate <= sevenDaysLater &&
                (t.dueDate < todayStart || t.dueDate >= todayEnd),
        ).length;
        const dueLater = myTasks.filter(
            (t) => t.dueDate && t.dueDate > sevenDaysLater,
        ).length;
        const noDue = myTasks.length - tasksWithDue.length;
        const myTasksByDueBucket: ChartDataPointDto[] = [
            { label: 'Overdue', value: dueOverdue },
            { label: 'Today', value: dueToday },
            { label: 'Next 7 days', value: dueSoon },
            { label: 'Later', value: dueLater },
            { label: 'No due date', value: noDue },
        ].filter((d) => d.value > 0);

        const projectCounts = new Map<string, number>();
        myTasks.forEach((t) => {
            const name = (t.project as { name?: string })?.name || 'Unknown';
            projectCounts.set(name, (projectCounts.get(name) || 0) + 1);
        });
        const myTasksByProject: ChartDataPointDto[] = Array.from(
            projectCounts.entries(),
        )
            .map(([label, value]) => ({ label, value }))
            .sort((a, b) => b.value - a.value);

        return {
            overview: {
                myProjectsCount: myProjectIds.length,
                myTasksAssigned: myTasks.length,
                myTasksOverdue,
                myTasksDueSoon,
                myTasksDueToday,
                myTasksCompleted,
                myTasksPending,
            },
            myTasksByStatus,
            myTasksByPriority,
            myTasksByDueBucket,
            myTasksByProject,
        };
    }

    private groupBy<T>(
        items: T[],
        keyFn: (item: T) => string | number,
        labelFn?: (k: string | number) => string,
    ): ChartDataPointDto[] {
        const map = new Map<string, number>();
        items.forEach((item) => {
            const k = keyFn(item);
            const label = labelFn ? labelFn(k) : String(k);
            map.set(label, (map.get(label) || 0) + 1);
        });
        return Array.from(map.entries()).map(([label, value]) => ({
            label,
            value,
        }));
    }

    private buildPhaseEndingsByMonth(
        endDates: Date[],
        from: Date,
    ): TimeSeriesPointDto[] {
        const byMonth = new Map<string, number>();
        for (let i = 0; i < 6; i++) {
            const d = new Date(from.getFullYear(), from.getMonth() + i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            byMonth.set(key, 0);
        }
        endDates.forEach((d) => {
            if (d < from) return;
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (byMonth.has(key)) byMonth.set(key, (byMonth.get(key) || 0) + 1);
        });
        return Array.from(byMonth.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([period, value]) => ({ period, value }));
    }

    private buildTaskDueByWeek(dueDates: Date[], from: Date): TimeSeriesPointDto[] {
        const result: TimeSeriesPointDto[] = [];
        for (let i = 0; i < 8; i++) {
            const weekStart = new Date(from);
            weekStart.setDate(weekStart.getDate() + i * 7);
            const weekEnd = new Date(weekStart);
            weekEnd.setDate(weekEnd.getDate() + 7);
            const count = dueDates.filter(
                (d) => d >= weekStart && d < weekEnd,
            ).length;
            result.push({
                period: `Week ${i + 1} (${weekStart.toISOString().slice(0, 10)})`,
                value: count,
            });
        }
        return result;
    }

    /**
     * Org-level task list + project list for dashboard cards
     */
    async getOrgTaskList(
        orgId: string,
        bucket: 'overdue' | 'due_soon' | 'due_today' | 'all',
        limit: number,
    ): Promise<TaskListResponseDto> {
        this.logger.log(`Fetching org task list for org ${orgId}, bucket=${bucket}`);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const sevenDaysLater = new Date(now);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const projects = await this.prisma.project.findMany({
            where: { orgId, isDeleted: false },
            select: { id: true, name: true, status: true, access: true },
        });
        const projectIds = projects.map((p) => p.id);

        const [taskCounts, overdueCounts, dueSoonCounts] = await Promise.all([
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: projectIds },
                    isDeleted: false,
                    parentId: null,
                },
                _count: { id: true },
            }),
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: projectIds },
                    isDeleted: false,
                    parentId: null,
                    dueDate: { lt: now },
                },
                _count: { id: true },
            }),
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: projectIds },
                    isDeleted: false,
                    parentId: null,
                    dueDate: { gte: now, lte: sevenDaysLater },
                },
                _count: { id: true },
            }),
        ]);

        const countByProject = (arr: { projectId: string; _count: { id: number } }[]) =>
            new Map(arr.map((x) => [x.projectId, x._count.id]));
        const totalMap = countByProject(taskCounts);
        const overdueMap = countByProject(overdueCounts);
        const dueSoonMap = countByProject(dueSoonCounts);

        const projectList: ProjectListItemDto[] = projects.map((p) => ({
            id: p.id,
            name: p.name,
            status: String(p.status).replace(/_/g, ' '),
            access: String(p.access),
            taskCount: totalMap.get(p.id) ?? 0,
            tasksOverdue: overdueMap.get(p.id) ?? 0,
            tasksDueSoon: dueSoonMap.get(p.id) ?? 0,
        }));

        const whereDue =
            bucket === 'overdue'
                ? { dueDate: { lt: now } }
                : bucket === 'due_soon'
                  ? { dueDate: { gte: now, lte: sevenDaysLater } }
                  : bucket === 'due_today'
                    ? { dueDate: { gte: todayStart, lt: todayEnd } }
                    : {};

        const tasks = await this.prisma.task.findMany({
            where: {
                projectId: { in: projectIds },
                isDeleted: false,
                parentId: null,
                ...whereDue,
            },
            take: limit,
            orderBy: { dueDate: 'asc' },
            select: {
                id: true,
                title: true,
                projectId: true,
                priority: true,
                dueDate: true,
                project: { select: { name: true } },
                status: { select: { name: true } },
                phase: { select: { name: true } },
                taskList: { select: { name: true } },
                assignees: {
                    select: {
                        user: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const total = await this.prisma.task.count({
            where: {
                projectId: { in: projectIds },
                isDeleted: false,
                parentId: null,
                ...whereDue,
            },
        });

        const items: TaskListItemDto[] = tasks.map((t) => ({
            id: t.id,
            title: t.title,
            projectId: t.projectId,
            projectName: (t.project as { name: string }).name,
            statusName: (t.status as { name: string }).name ?? 'Unknown',
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            priority: t.priority,
            priorityLabel: PRIORITY_LABELS[t.priority] ?? `Priority ${t.priority}`,
            assignees: (t.assignees ?? []).map((a) => ({
                id: (a.user as { id: string }).id,
                name: (a.user as { name: string | null }).name ?? null,
            })),
            phaseName: (t.phase as { name: string } | null)?.name ?? null,
            taskListName: (t.taskList as { name: string } | null)?.name ?? null,
        }));

        return { items, total, projects: projectList };
    }

    /**
     * User-level "mine" task list + project list for dashboard cards
     */
    async getMineTaskList(
        orgId: string,
        userId: string,
        bucket: 'overdue' | 'due_soon' | 'due_today' | 'all',
        limit: number,
    ): Promise<TaskListResponseDto> {
        this.logger.log(`Fetching mine task list for user ${userId}, bucket=${bucket}`);

        const now = new Date();
        const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const todayEnd = new Date(todayStart);
        todayEnd.setDate(todayEnd.getDate() + 1);
        const sevenDaysLater = new Date(now);
        sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

        const myProjects = await this.prisma.project.findMany({
            where: {
                orgId,
                isDeleted: false,
                members: {
                    some: { userId, isActive: true },
                },
            },
            select: { id: true, name: true, status: true, access: true },
        });
        const myProjectIds = myProjects.map((p) => p.id);

        const [taskCounts, overdueCounts, dueSoonCounts] = await Promise.all([
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: myProjectIds },
                    isDeleted: false,
                    parentId: null,
                    assignees: { some: { userId } },
                },
                _count: { id: true },
            }),
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: myProjectIds },
                    isDeleted: false,
                    parentId: null,
                    assignees: { some: { userId } },
                    dueDate: { lt: now },
                },
                _count: { id: true },
            }),
            this.prisma.task.groupBy({
                by: ['projectId'],
                where: {
                    projectId: { in: myProjectIds },
                    isDeleted: false,
                    parentId: null,
                    assignees: { some: { userId } },
                    dueDate: { gte: now, lte: sevenDaysLater },
                },
                _count: { id: true },
            }),
        ]);

        const countByProject = (arr: { projectId: string; _count: { id: number } }[]) =>
            new Map(arr.map((x) => [x.projectId, x._count.id]));
        const totalMap = countByProject(taskCounts);
        const overdueMap = countByProject(overdueCounts);
        const dueSoonMap = countByProject(dueSoonCounts);

        const projectList: ProjectListItemDto[] = myProjects.map((p) => ({
            id: p.id,
            name: p.name,
            status: String(p.status).replace(/_/g, ' '),
            access: String(p.access),
            taskCount: totalMap.get(p.id) ?? 0,
            tasksOverdue: overdueMap.get(p.id) ?? 0,
            tasksDueSoon: dueSoonMap.get(p.id) ?? 0,
        }));

        const whereDue =
            bucket === 'overdue'
                ? { dueDate: { lt: now } }
                : bucket === 'due_soon'
                  ? { dueDate: { gte: now, lte: sevenDaysLater } }
                  : bucket === 'due_today'
                    ? { dueDate: { gte: todayStart, lt: todayEnd } }
                    : {};

        const tasks = await this.prisma.task.findMany({
            where: {
                projectId: { in: myProjectIds },
                isDeleted: false,
                parentId: null,
                assignees: { some: { userId } },
                ...whereDue,
            },
            take: limit,
            orderBy: { dueDate: 'asc' },
            select: {
                id: true,
                title: true,
                projectId: true,
                priority: true,
                dueDate: true,
                project: { select: { name: true } },
                status: { select: { name: true } },
                phase: { select: { name: true } },
                taskList: { select: { name: true } },
                assignees: {
                    select: {
                        user: { select: { id: true, name: true } },
                    },
                },
            },
        });

        const total = await this.prisma.task.count({
            where: {
                projectId: { in: myProjectIds },
                isDeleted: false,
                parentId: null,
                assignees: { some: { userId } },
                ...whereDue,
            },
        });

        const items: TaskListItemDto[] = tasks.map((t) => ({
            id: t.id,
            title: t.title,
            projectId: t.projectId,
            projectName: (t.project as { name: string }).name,
            statusName: (t.status as { name: string }).name ?? 'Unknown',
            dueDate: t.dueDate ? t.dueDate.toISOString() : null,
            priority: t.priority,
            priorityLabel: PRIORITY_LABELS[t.priority] ?? `Priority ${t.priority}`,
            assignees: (t.assignees ?? []).map((a) => ({
                id: (a.user as { id: string }).id,
                name: (a.user as { name: string | null }).name ?? null,
            })),
            phaseName: (t.phase as { name: string } | null)?.name ?? null,
            taskListName: (t.taskList as { name: string } | null)?.name ?? null,
        }));

        return { items, total, projects: projectList };
    }

    /**
     * List users/members in the current org with profile and task-assignment counts
     */
    async getOrgUsers(orgId: string): Promise<OrgUsersResponseDto> {
        this.logger.log(`Fetching org users for org ${orgId}`);

        const members = await this.prisma.orgMember.findMany({
            where: { orgId, isActive: true },
            select: {
                userId: true,
                email: true,
                role: true,
                status: true,
                joinedAt: true,
                user: {
                    select: { id: true, name: true, email: true },
                },
            },
            orderBy: { joinedAt: 'desc' },
        });

        const userIds = members
            .map((m) => m.userId)
            .filter((id): id is string => id != null);

        const completedLike = (name: string) => /done|complete/i.test(name || '');

        type UserTaskCounts = { total: number; completed: number; pending: number };
        const countsByUser = new Map<string, UserTaskCounts>();

        if (userIds.length > 0) {
            const assignees = await this.prisma.taskAssignee.findMany({
                where: {
                    userId: { in: userIds },
                    task: {
                        project: { orgId },
                        isDeleted: false,
                        parentId: null,
                    },
                },
                select: {
                    userId: true,
                    task: { select: { status: { select: { name: true } } } },
                },
            });

            for (const uid of userIds) {
                countsByUser.set(uid, { total: 0, completed: 0, pending: 0 });
            }
            for (const a of assignees) {
                const c = countsByUser.get(a.userId)!;
                c.total += 1;
                if (completedLike((a.task.status as { name: string }).name)) {
                    c.completed += 1;
                } else {
                    c.pending += 1;
                }
            }
        }

        const users: OrgUserListItemDto[] = members.map((m) => {
            const counts = m.userId ? countsByUser.get(m.userId) : null;
            const total = counts?.total ?? 0;
            const completed = counts?.completed ?? 0;
            const pending = counts?.pending ?? 0;
            return {
                userId: m.userId ?? null,
                name: m.user?.name ?? null,
                email: (m.user?.email ?? m.email) ?? null,
                role: String(m.role),
                status: String(m.status),
                joinedAt: m.joinedAt.toISOString(),
                tasksAssignedCount: total,
                tasksCompleted: completed,
                tasksPending: pending,
            };
        });

        return { users, total: users.length };
    }
}
