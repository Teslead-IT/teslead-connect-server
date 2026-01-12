import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { CreateProjectDto } from './dto/project.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { OrgId, UserId } from '../../common/decorators/org.decorator';
import { OrgRole } from '@prisma/client';

/**
 * Projects Controller
 * - Create projects (ADMIN/OWNER only)
 * - List projects (all members)
 * - Get project details
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard → RolesGuard
 */
@Controller('projects')
@UseGuards(JwtAuthGuard, OrgGuard, RolesGuard)
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * POST /projects
   * - Only ADMIN/OWNER can create projects
   * - Creator automatically becomes project ADMIN
   */
  @Post()
  @Roles(OrgRole.ADMIN, OrgRole.OWNER)
  async create(
    @OrgId() orgId: string,
    @UserId() userId: string,
    @Body() createProjectDto: CreateProjectDto,
  ) {
    this.logger.log(`Creating project in org ${orgId}`);
    return this.projectsService.create(orgId, userId, createProjectDto);
  }

  /**
   * GET /projects
   * - Lists all projects user has access to in current org
   */
  @Get()
  async list(@OrgId() orgId: string, @UserId() userId: string) {
    return this.projectsService.listUserProjects(orgId, userId);
  }

  /**
   * GET /projects/:id
   * - Gets project details
   */
  @Get(':id')
  async get(
    @Param('id') projectId: string,
    @OrgId() orgId: string,
    @UserId() userId: string,
  ) {
    return this.projectsService.getProject(projectId, orgId, userId);
  }
}
