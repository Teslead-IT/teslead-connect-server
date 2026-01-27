import { Injectable, NotFoundException, Logger, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateTaskDto, UpdateTaskStatusDto, UpdateTaskDto } from './dto/task.dto';

import { NotificationService } from '../notifications/notification.service';

/**
 * Tasks Service
 * - Manages tasks within projects
 * - Tracks status changes
 * - Supports subtasks
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private prisma: PrismaService,
    private notificationService: NotificationService,
  ) { }

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

    const result = {
      id: task.id,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      dueDate: task.dueDate,
    };

    // Notify assignees
    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      this.notifyAssignees(dto.assigneeIds, task.id, task.title, projectId, userId);
    }

    return result;
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

  /**
   * Update full task data
   */
  async update(taskId: string, userId: string, dto: UpdateTaskDto) {
    console.log("Update>>>>>>>>>>>>", dto, userId, taskId)
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        status: true,
      },
    });

    if (!task) {
      throw new NotFoundException('Task not found');
    }

    // If status is changing, verify it
    if (dto.statusId && dto.statusId !== task.statusId) {
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
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Update basic fields
      const updatedTask = await tx.task.update({
        where: { id: taskId },
        data: {
          title: dto.title,
          description: dto.description,
          statusId: dto.statusId,
          priority: dto.priority,
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          // Handle parentId update if needed? Usually requires circle check, limiting for now to simple update
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
      });

      // Handle Status Change History
      if (dto.statusId && dto.statusId !== task.statusId) {
        await tx.taskStatusHistory.create({
          data: {
            taskId,
            statusId: dto.statusId,
            userId,
          },
        });
      }

      // Handle Assignees
      if (dto.assigneeIds) {
        await tx.taskAssignee.deleteMany({
          where: { taskId },
        });

        if (dto.assigneeIds.length > 0) {
          await tx.taskAssignee.createMany({
            data: dto.assigneeIds.map((assigneeId: string) => ({
              taskId,
              userId: assigneeId,
            })),
          });
        }
      }

      // Re-fetch to get included relations with new assignees
      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
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
      });
    });

    this.logger.log(`Task ${taskId} updated by user ${userId}`);

    // Notify new assignees
    if (dto.assigneeIds && dto.assigneeIds.length > 0) {
      this.notifyAssignees(dto.assigneeIds, taskId, updated.title, updated.projectId, userId);
    }

    return updated;
  }

  /**
   * Helper to get all descendant task IDs recursively
   */
  private async getAllDescendantIds(taskId: string): Promise<string[]> {
    const children = await this.prisma.task.findMany({
      where: { parentId: taskId, isDeleted: false },
      select: { id: true },
    });

    let ids = children.map((c) => c.id);
    for (const child of children) {
      const descendants = await this.getAllDescendantIds(child.id);
      ids = [...ids, ...descendants];
    }
    return ids;
  }

  /**
   * Delete task
   * - Soft deletes task and all recursive subtasks
   */
  async remove(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task || task.isDeleted) {
      throw new NotFoundException('Task not found');
    }

    const descendantIds = await this.getAllDescendantIds(taskId);
    const allIds = [taskId, ...descendantIds];

    await this.prisma.task.updateMany({
      where: {
        id: { in: allIds },
      },
      data: {
        isDeleted: true,
      },
    });

    this.logger.log(
      `Task ${taskId} and ${descendantIds.length} subtasks soft deleted`,
    );
    return { message: 'Task deleted successfully' };
  }

  /**
   * Add assignee to task
   */
  async addAssignee(taskId: string, assigneeId: string, assignerId?: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        project: {
          select: { name: true }
        }
      }
    });

    if (!task) throw new NotFoundException('Task not found');

    // Check if subscription already exists
    const exists = await this.prisma.taskAssignee.findUnique({
      where: {
        taskId_userId: {
          taskId,
          userId: assigneeId,
        },
      },
    });

    if (exists) {
      return { message: 'User already assigned' };
    }

    // Check User Project Role
    const projectMember = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: task.projectId,
          userId: assigneeId
        }
      },
      select: { role: true }
    });

    if (!projectMember) {
      // Ideally this shouldn't happen if user is in the org/project list, but strictly:
      // throw new ForbiddenException('User is not a member of this project');
      // Or strictly just checking for VIEWER:
    }

    if (projectMember && projectMember.role === 'VIEWER') {
      throw new ForbiddenException('Cannot assign task to a VIEWER');
    }

    await this.prisma.taskAssignee.create({
      data: {
        taskId,
        userId: assigneeId,
      },
    });

    // Send Notification

    if (assignerId) {
      await this.notifyAssignees([assigneeId], taskId, task.title, task.projectId, assignerId);
    }

    return this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        assignees: {
          select: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true
              }
            }
          }
        }
      }
    });
  }

  /**
   * Remove assignee from task
   */
  async removeAssignee(taskId: string, assigneeId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
    });

    if (!task) throw new NotFoundException('Task not found');

    try {
      await this.prisma.taskAssignee.delete({
        where: {
          taskId_userId: {
            taskId,
            userId: assigneeId,
          },
        },
      });
    } catch (e) {
      // Ignore if not found
    }

    return { message: 'Assignee removed' };
  }

  /**
   * Bulk assign user to multiple tasks
   */
  async assignUserToTasks(taskIds: string[], userId: string, assignerId?: string) {
    if (!taskIds || taskIds.length === 0) return { message: 'No tasks provided' };

    // filter valid tasks
    const tasks = await this.prisma.task.findMany({
      where: {
        id: { in: taskIds },
        isDeleted: false,
      },
      select: {
        id: true,
        projectId: true,
        title: true,
        project: {
          select: { name: true }
        }
      },
    });

    if (tasks.length === 0) {
      return { message: 'No valid tasks found' };
    }

    // In a real scenario, we should check if user has access to these projects
    // expecting the controller/guard to have handled basic org access

    // Check Permissions for all projects involved (usually just one, but supporting multi)
    const projectIds = [...new Set(tasks.map(t => t.projectId))];

    // Check membership for all these projects
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        projectId: { in: projectIds }
      },
      select: { projectId: true, role: true }
    });

    const membershipMap = new Map(memberships.map(m => [m.projectId, m.role]));

    // Check if any is viewer or missing
    for (const projectId of projectIds) {
      const role = membershipMap.get(projectId);
      if (role === 'VIEWER') {
        throw new ForbiddenException(`Cannot assign task to a VIEWER in project ${projectId}`);
      }
    }

    const created = await this.prisma.$transaction(
      tasks.map((task) =>
        this.prisma.taskAssignee.upsert({
          where: {
            taskId_userId: {
              taskId: task.id,
              userId,
            },
          },
          update: {}, // Do nothing if exists
          create: {
            taskId: task.id,
            userId,
          },
        }),
      ),
    );

    // Send Notifications
    if (assignerId) {
      const assigner = await this.prisma.user.findUnique({
        where: { id: assignerId },
        select: { name: true }
      });

      const assignerName = assigner?.name || 'Unknown';

      // We only want to notify for newly assigned tasks, but upsert makes it tricky to know exactly which resulted in a create.
      // Ideally returned 'created' objects would tell us, but $transaction with map returns results of operations.
      // upsert returns the record. We can check createdAt vs now, but that's flaky.
      // For now, let's just notify for all valid tasks in the request, or we could try to filter.
      // Actually, checking if assignment existed before is better, but expensive.
      // Given the bulk nature, we can just notify for all tasks in the list since the user INTENDED to assign them.
      // OR, we can just live with potential duplicate notifications if re-assigning? 
      // Upsert returns the object. If createdAt is very recent, it's new.

      for (const task of tasks) {
        // This is simpler to just fire off. The user experience of "You were assigned to X" is repeating if they run it again is acceptable for bulk ops.
        await this.notificationService.sendTaskAssignmentNotification(
          userId,
          task.id,
          task.title,
          task.projectId,
          task.project.name,
          assignerName
        );
      }
    }

    return {
      message: `User assigned to ${created.length} tasks`,
      count: created.length,
    };
  }

  /**
   * Get all assignees for a task
   */
  async getTaskAssignees(taskId: string) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId, isDeleted: false },
      select: {
        id: true,
        title: true,
        assignees: {
          select: {
            id: true,
            assignedAt: true,
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatarUrl: true,
              },
            },
          },
        },
      },
    });

    if (!task) throw new NotFoundException('Task not found');

    return {
      taskId: task.id,
      taskTitle: task.title,
      assignees: task.assignees.map((a) => ({
        assignmentId: a.id,
        assignedAt: a.assignedAt,
        user: a.user,
      })),
    };
  }

  /**
   * Helper to notify assignees
   */
  private async notifyAssignees(
    assigneeIds: string[],
    taskId: string,
    taskTitle: string,
    projectId: string,
    assignerId: string
  ) {
    try {
      if (!assigneeIds || assigneeIds.length === 0) return;

      const [project, assigner] = await Promise.all([
        this.prisma.project.findUnique({ where: { id: projectId }, select: { name: true } }),
        this.prisma.user.findUnique({ where: { id: assignerId }, select: { name: true } })
      ]);

      const assignerName = assigner?.name || 'Unknown';
      const projectName = project?.name || 'Unknown Project';

      for (const assigneeId of assigneeIds) {
        if (assigneeId === assignerId) continue; // Don't notify self

        await this.notificationService.sendTaskAssignmentNotification(
          assigneeId,
          taskId,
          taskTitle,
          projectId,
          projectName,
          assignerName
        );
      }
    } catch (e) {
      this.logger.error(`Failed to notify assignees for task ${taskId}`, e);
    }
  }
}
