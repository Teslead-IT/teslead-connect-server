import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateProjectDto } from './dto/project.dto';
import { ProjectRole } from '@prisma/client';

/**
 * Projects Service
 * - Manages projects within organizations
 * - Enforces tenant isolation
 * - Creates default workflow when creating project
 */
@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create project
   * - Project belongs to organization (tenant-scoped)
   * - Creator becomes project ADMIN
   * - Creates default workflow (stages + statuses)
   */
  async create(orgId: string, userId: string, dto: CreateProjectDto) {
    const project = await this.prisma.$transaction(async (tx) => {
      // Create project
      const newProject = await tx.project.create({
        data: {
          orgId,
          name: dto.name,
          description: dto.description,
          color: dto.color,
        },
      });

      // Add creator as project ADMIN
      await tx.projectMember.create({
        data: {
          projectId: newProject.id,
          userId,
          role: ProjectRole.ADMIN,
        },
      });

      // Create default workflow
      await this.createDefaultWorkflow(tx, newProject.id);

      return newProject;
    });

    this.logger.log(`Created project ${project.id} in org ${orgId}`);

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      role: ProjectRole.ADMIN,
    };
  }

  /**
   * List projects user has access to in organization
   */
  async listUserProjects(orgId: string, userId: string) {
    const memberships = await this.prisma.projectMember.findMany({
      where: {
        userId,
        isActive: true,
        project: {
          orgId,
          isDeleted: false,
          isArchived: false,
        },
      },
      select: {
        role: true,
        joinedAt: true,
        project: {
          select: {
            id: true,
            name: true,
            description: true,
            color: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'desc',
      },
    });

    return memberships.map((m) => ({
      id: m.project.id,
      name: m.project.name,
      description: m.project.description,
      color: m.project.color,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.project.createdAt,
    }));
  }

  /**
   * Get project details
   */
  async getProject(projectId: string, orgId: string, userId: string) {
    // Verify project belongs to org
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        orgId,
        isDeleted: false,
      },
      select: {
        id: true,
        name: true,
        description: true,
        color: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!project) {
      throw new NotFoundException('Project not found');
    }

    // Get user's role in project
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId,
          userId,
        },
      },
    });

    if (!membership || !membership.isActive) {
      throw new ForbiddenException('You do not have access to this project');
    }

    return {
      ...project,
      role: membership.role,
    };
  }

  /**
   * Create default workflow for new project
   * Stages: To Do → In Progress → Done
   * Statuses: Not Started, Working, Stuck, Completed
   */
  private async createDefaultWorkflow(tx: any, projectId: string) {
    // Stage 1: To Do
    const toDo = await tx.taskStage.create({
      data: {
        projectId,
        name: 'To Do',
        order: 1,
        color: '#E85D75',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: toDo.id,
        name: 'Not Started',
        order: 1,
        color: '#C4C4C4',
        isDefault: true, // This is the default status for new tasks
      },
    });

    // Stage 2: In Progress
    const inProgress = await tx.taskStage.create({
      data: {
        projectId,
        name: 'In Progress',
        order: 2,
        color: '#FDAB3D',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: inProgress.id,
        name: 'Working On It',
        order: 1,
        color: '#FDAB3D',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: inProgress.id,
        name: 'Stuck',
        order: 2,
        color: '#E85D75',
      },
    });

    // Stage 3: Done
    const done = await tx.taskStage.create({
      data: {
        projectId,
        name: 'Done',
        order: 3,
        color: '#00C875',
      },
    });

    await tx.taskStatus.create({
      data: {
        projectId,
        stageId: done.id,
        name: 'Completed',
        order: 1,
        color: '#00C875',
      },
    });

    this.logger.log(`Created default workflow for project ${projectId}`);
  }
}
