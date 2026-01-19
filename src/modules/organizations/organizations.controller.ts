import { Controller, Get, Post, Body, UseGuards, Logger, Param } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrgDto } from './dto/organization.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserId } from '../../common/decorators/org.decorator';

/**
 * Organizations Controller
 * - Create organizations
 * - List user's organizations
 */
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) { }

  /**
   * POST /organizations
   * - Creates new organization
   * - User becomes OWNER
   */
  @Post()
  async create(@UserId() userId: string, @Body() createOrgDto: CreateOrgDto) {
    this.logger.log(`User ${userId} creating org: ${createOrgDto.name}`);
    return this.organizationsService.create(userId, createOrgDto);
  }

  /**
   * GET /organizations
   * - Lists all organizations user belongs to
   */
  @Get()
  async list(@UserId() userId: string) {
    return this.organizationsService.listUserOrganizations(userId);
  }

  /**
   * GET /organizations/:id/onboarding-status
   * - Checks onboarding readiness (email, phone, admin existence)
   */
  @Get(':id/onboarding-status')
  async getOnboardingStatus(@UserId() userId: string, @Param('id') orgId: string) {
    return this.organizationsService.getOnboardingStatus(userId, orgId);
  }

  /**
   * POST /organizations/:id/members
   * - Invite a member by email
   * - Only ADMIN/OWNER can invite
   */
  @Post(':id/members')
  async inviteMember(
    @UserId() userId: string,
    @Param('id') orgId: string,
    @Body() inviteDto: InviteMemberDto,
  ) {
    this.logger.log(`User ${userId} inviting ${inviteDto.email} to org ${orgId}`);
    return this.organizationsService.inviteMember(userId, orgId, inviteDto.email, inviteDto.role);
  }
}
