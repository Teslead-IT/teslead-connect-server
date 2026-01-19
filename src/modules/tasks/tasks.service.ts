import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskStatusDto } from './dto/task.dto';

/**
 * Tasks Service
 * - Manages tasks within projects
 * - Tracks status changes
 * - Supports subtasks
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(private prisma: PrismaService) { }

  /**
   * Create task
   * - Uses default status if not specified
   * - Can create subtasks via parentId
   */
  async create(projectId: string, userId: string, dto: CreateTaskDto) {
    // Get default status if not provided
    let statusId = dto.statusId;

    if (!statusId) {
      const defaultStatus = await this.prisma.taskStatus.findFirst({
        where: {
          projectId,
          isDefault: true,
          isDeleted: false,
        },
      });

      if (!defaultStatus) {
        throw new NotFoundException('No default status found for project');
      }

      statusId = defaultStatus.id;
    }

    // Get next order number
    const maxOrder = await this.prisma.task.findFirst({
      where: {
        projectId,
        statusId,
        parentId: dto.parentId || null,
      },
      orderBy: {
        order: 'desc',
      },
      select: {
        order: true,
      },
    });

    const order = (maxOrder?.order ?? 0) + 1;

    // Create task
    const task = await this.prisma.$transaction(async (tx) => {
      const newTask = await tx.task.create({
        data: {
          projectId,
          statusId,
          parentId: dto.parentId,
          title: dto.title,
          description: dto.description,
          priority: dto.priority || 0,
          order,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
        include: {
          status: {
            select: {
              name: true,
              color: true,
            },
          },
        },
      });

      // Record initial status in history
      await tx.taskStatusHistory.create({
        data: {
          taskId: newTask.id,
          statusId: newTask.statusId,
          userId,
        },
      });

      // Assign users if provided
      if (dto.assigneeIds && dto.assigneeIds.length > 0) {
        await tx.taskAssignee.createMany({
          data: dto.assigneeIds.map((assigneeId) => ({
            taskId: newTask.id,
            userId: assigneeId,
          })),
        });
      }

      return newTask;
    });

    this.logger.log(`Created task ${task.id} in project ${projectId}`);

    return {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
    };
  }

  /**
   * List all tasks in project
   */
  async listProjectTasks(projectId: string) {
    const tasks = await this.prisma.task.findMany({
      where: {
        projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        order: true,
        dueDate: true,
        createdAt: true,
        parentId: true,
        status: {
          select: {
            id: true,
            name: true,
            color: true,
            stage: {
              select: {
                name: true,
              },
            },
          },
        },
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
        },
        tags: {
          select: {
            tag: {
              select: {
                id: true,
                name: true,
                color: true,
              },
            },
          },
        },
      },
      orderBy: [{ order: 'asc' }],
    });

    return tasks.map((task) => ({
      id: task.id,
      title: task.title,
      description: task.description,
      priority: task.priority,
      order: task.order,
      dueDate: task.dueDate,
      parentId: task.parentId,
      createdAt: task.createdAt,
      status: {
        id: task.status.id,
        name: task.status.name,
        color: task.status.color,
        stageName: task.status.stage.name,
      },
      assignees: task.assignees.map((a) => a.user),
      tags: task.tags.map((t) => t.tag),
    }));
  }

  /**
   * Update task status
   * - Records change in history
   * - Tracks who made the change
   */
  async updateStatus(taskId: string, userId: string, dto: UpdateTaskStatusDto) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        projectId: true,
        statusId: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // Verify new status belongs to same project
    const newStatus = await this.prisma.taskStatus.findFirst({
      where: {
        id: dto.statusId,
        projectId: task.projectId,
        isDeleted: false,
      },
    });

    if (!newStatus) {
      throw new NotFoundException(
        'Status not found or does not belong to this project',
      );
    }

    // Update task and record history
    const updated = await this.prisma.$transaction(async (tx) => {
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          statusId: dto.statusId,
        },
        include: {
          status: {
            select: {
              id: true,
              name: true,
              color: true,
              stage: {
                select: {
                  name: true,
                },
              },
            },
          },
        },
      });

      // Record status change
      await tx.taskStatusHistory.create({
        data: {
          taskId,
          statusId: dto.statusId,
          userId,
        },
      });

      return updatedTask;
    });

    this.logger.log(
      `Task ${taskId} status changed to ${dto.statusId} by user ${userId}`,
    );

    return {
      id: updated.id,
      title: updated.title,
      status: {
        id: updated.status.id,
        name: updated.status.name,
        color: updated.status.color,
        stageName: updated.status.stage.name,
      },
    };
  }
}
