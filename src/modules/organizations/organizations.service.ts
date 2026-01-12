import { Injectable, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrgDto } from './dto/organization.dto';
import { OrgRole } from '@prisma/client';

/**
 * Organizations Service
 * - Manages organization CRUD
 * - Handles membership
 */
@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Create organization
   * - Generates unique slug
   * - Makes creator OWNER
   */
  async create(userId: string, dto: CreateOrgDto) {
    // Generate slug from name
    const slug = this.generateSlug(dto.name);

    // Check if slug already exists
    const existing = await this.prisma.organization.findUnique({
      where: { slug },
    });

    if (existing) {
      throw new ConflictException('Organization with this name already exists');
    }

    // Create org with owner membership in transaction
    const org = await this.prisma.$transaction(async (tx) => {
      const newOrg = await tx.organization.create({
        data: {
          name: dto.name,
          slug,
        },
      });

      // Add creator as OWNER
      await tx.orgMember.create({
        data: {
          userId,
          orgId: newOrg.id,
          role: OrgRole.OWNER,
        },
      });

      return newOrg;
    });

    this.logger.log(`Created org: ${org.id} (${org.slug}) by user ${userId}`);

    return {
      id: org.id,
      name: org.name,
      slug: org.slug,
      role: OrgRole.OWNER,
    };
  }

  /**
   * List all organizations user belongs to
   */
  async listUserOrganizations(userId: string) {
    const memberships = await this.prisma.orgMember.findMany({
      where: {
        userId,
        isActive: true,
        org: {
          isDeleted: false,
        },
      },
      select: {
        role: true,
        joinedAt: true,
        org: {
          select: {
            id: true,
            name: true,
            slug: true,
            createdAt: true,
          },
        },
      },
      orderBy: {
        joinedAt: 'asc',
      },
    });

    return memberships.map((m) => ({
      id: m.org.id,
      name: m.org.name,
      slug: m.org.slug,
      role: m.role,
      joinedAt: m.joinedAt,
      createdAt: m.org.createdAt,
    }));
  }

  /**
   * Generate URL-friendly slug from name
   */
  private generateSlug(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }
}
