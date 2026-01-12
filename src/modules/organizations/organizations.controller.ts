import { Controller, Get, Post, Body, UseGuards, Logger } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { CreateOrgDto } from './dto/organization.dto';
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

  constructor(private readonly organizationsService: OrganizationsService) {}

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
}
