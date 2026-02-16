import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Project Guard
 * - Verifies user has access to project
 * - Attaches projectId and project role to request
 * - Works in conjunction with OrgGuard
 *
 * This is the THIRD guard (optional, only for project routes)
 */
@Injectable()
export class ProjectGuard implements CanActivate {
  private readonly logger = new Logger(ProjectGuard.name);

  constructor(private prisma: PrismaService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;
    const orgId = request.orgId;

    // Extract projectId from params or body
    const projectId =
      request.params.projectId || request.params.id || request.body.projectId;

    if (!projectId) {
      this.logger.warn('ProjectGuard: No projectId in request');
      throw new ForbiddenException('Project ID required');
    }

    // Verify project exists (ignore org context to allow cross-org access for members)
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        isDeleted: false,
      },
      select: {
        id: true,
        orgId: true,
      },
    });

    if (!project) {
      this.logger.warn(
        `ProjectGuard: Project ${projectId} not found`,
      );
      throw new ForbiddenException('Project not found or access denied');
    }

    // Verify user is member of this project
    const membership = await this.prisma.projectMember.findUnique({
      where: {
        projectId_userId: {
          projectId: projectId,
          userId: user.userId,
        },
      },
      select: {
        role: true,
        isActive: true,
      },
    });

    // If not project member: allow if user is Org Admin/Owner of the PROJECT's org (Model B)
    // This handles: user selects project from "Global (All Projects)" where project's org != request org
    let isOrgAdmin = false;
    if (!membership || !membership.isActive) {
      const orgMember = await this.prisma.orgMember.findUnique({
        where: {
          userId_orgId: {
            userId: user.userId,
            orgId: project.orgId,
          },
        },
        select: { role: true, isActive: true },
      });
      isOrgAdmin =
        !!orgMember?.isActive &&
        (orgMember.role === 'ADMIN' || orgMember.role === 'OWNER');
    }

    if ((!membership || !membership.isActive) && !isOrgAdmin) {
      this.logger.warn(
        `ProjectGuard: User ${user.userId} not member of project ${projectId}`,
      );
      throw new ForbiddenException('You do not have access to this project');
    }

    // Attach to request
    request.projectId = projectId;
    request.projectRole = membership?.role || (isOrgAdmin ? 'ADMIN' : null);

    // Update orgId to the project's org (handles cross-org access)
    request.orgId = project.orgId;

    return true;
  }
}
