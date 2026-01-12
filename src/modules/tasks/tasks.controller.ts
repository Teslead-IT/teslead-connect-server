import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskStatusDto } from './dto/task.dto';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { ProjectGuard } from '../../common/guards/project.guard';
import { UserId } from '../../common/decorators/org.decorator';

/**
 * Tasks Controller
 * - Create tasks
 * - Update task status
 * - List tasks in project
 *
 * Guard Pipeline: JwtAuthGuard → OrgGuard → ProjectGuard
 */
@Controller()
@UseGuards(JwtAuthGuard, OrgGuard)
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

  /**
   * POST /projects/:projectId/tasks
   * - Creates task in project
   */
  @Post('projects/:projectId/tasks')
  @UseGuards(ProjectGuard)
  async create(
    @Param('projectId') projectId: string,
    @UserId() userId: string,
    @Body() createTaskDto: CreateTaskDto,
  ) {
    this.logger.log(`Creating task in project ${projectId}`);
    return this.tasksService.create(projectId, userId, createTaskDto);
  }

  /**
   * GET /projects/:projectId/tasks
   * - Lists all tasks in project
   */
  @Get('projects/:projectId/tasks')
  @UseGuards(ProjectGuard)
  async list(@Param('projectId') projectId: string) {
    return this.tasksService.listProjectTasks(projectId);
  }

  /**
   * PATCH /tasks/:id/status
   * - Updates task status
   * - Records status change in history
   */
  @Patch('tasks/:id/status')
  async updateStatus(
    @Param('id') taskId: string,
    @UserId() userId: string,
    @Body() updateStatusDto: UpdateTaskStatusDto,
  ) {
    this.logger.log(`Updating task ${taskId} status`);
    return this.tasksService.updateStatus(taskId, userId, updateStatusDto);
  }
}
