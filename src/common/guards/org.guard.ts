import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Organization Guard
 * - Verifies user belongs to organization from JWT
 * - Attaches orgId and user's role to request
 * - Prevents cross-tenant data access
 *
 * This is the SECOND guard in the pipeline (after JwtAuthGuard)
 */
@Injectable()
export class OrgGuard implements CanActivate {
  private readonly logger = new Logger(OrgGuard.name);

  constructor(private prisma: PrismaService) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Check for explicit Org ID in headers (Context Switching)
    const headerOrgId = request.headers['x-org-id'];
    const targetOrgId = headerOrgId || user.orgId;

    if (!targetOrgId) {
      this.logger.warn('OrgGuard: No Org ID found in header or token');
      throw new ForbiddenException('Organization context missing');
    }

    // Verify user actually belongs to this organization
    const membership = await this.prisma.orgMember.findUnique({
      where: {
        userId_orgId: {
          userId: user.userId,
          orgId: targetOrgId,
        },
      },
      select: {
        role: true,
        isActive: true,
      },
    });

    if (!membership || !membership.isActive) {
      this.logger.warn(
        `OrgGuard: User ${user.userId} not member of org ${targetOrgId}`,
      );
      throw new ForbiddenException(
        'You do not have access to this organization',
      );
    }

    // Attach orgId and role to request for downstream use
    request.orgId = targetOrgId;
    request.orgRole = membership.role;

    return true;
  }
}
