import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { TasksService } from './tasks.service';
import { CreateTaskDto, UpdateTaskStatusDto, UpdateTaskDto, AddAssigneeDto, BulkAssignDto, MyTasksQueryDto } from './dto/task.dto';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { OrgGuard } from '../../common/guards/org.guard';
import { ProjectGuard } from '../../common/guards/project.guard';
import { UserId, OrgId } from '../../common/decorators/org.decorator';

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

  constructor(private readonly tasksService: TasksService) { }

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
    // console.log("Create>>>>>>>>>>>>", createTaskDto, userId, projectId)
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
   * GET /tasks/my-tasks
   * - Lists all tasks assigned to the current user across all projects in the org
   * - Returns detailed data (projectName, dueDate, status, assignees, tags)
   * - Paginated
   */
  @Get('tasks/my-tasks')
  async findMyTasks(
    @UserId() userId: string,
    @OrgId() orgId: string,
    @Query() query: MyTasksQueryDto,
  ) {
    this.logger.log(`Fetching my tasks for user ${userId}`);
    return this.tasksService.findMyTasks(userId, orgId, query);
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

  /**
   * PATCH /tasks/:id
   * - Updates task details
   */
  @Patch('tasks/:id')
  async update(
    @Param('id') taskId: string,
    @UserId() userId: string,
    @Body() updateTaskDto: UpdateTaskDto,
  ) {
    // this.logger.log(`Reqested body data ${updateTaskDto}`)
    this.logger.log(`Updating task ${taskId}`);
    return this.tasksService.update(taskId, userId, updateTaskDto);
  }

  /**
   * DELETE /tasks/:id
   * - Deletes task and its subtasks
   */
  @Delete('tasks/:id')
  async remove(@Param('id') taskId: string) {
    this.logger.log(`Deleting task ${taskId}`);
    return this.tasksService.remove(taskId);
  }

  /**
   * POST /tasks/:id/assignees
   * - Add assignee to task
   */
  @Post('tasks/:id/assignees')
  async addAssignee(
    @Param('id') taskId: string,
    @Body() dto: AddAssigneeDto,
    @UserId() assignerId: string,
  ) {
    return this.tasksService.addAssignee(taskId, dto.userId, assignerId);
  }

  /**
   * POST /tasks/bulk-assign
   * - Assign user to multiple tasks
   */
  @Post('tasks/bulk-assign')
  async bulkAssign(
    @Body() dto: BulkAssignDto,
    @UserId() assignerId: string,
  ) {
    return this.tasksService.assignUserToTasks(dto.taskIds, dto.userId, assignerId);
  }

  /**
   * GET /tasks/:id/assignees
   * - Get all assignees for a task
   */
  @Get('tasks/:id/assignees')
  async getAssignees(
    @Param('id') taskId: string,
  ) {
    return this.tasksService.getTaskAssignees(taskId);
  }

  /**
   * DELETE /tasks/:id/assignees/:userId
   * - Remove assignee from task
   */
  @Delete('tasks/:id/assignees/:userId')
  async removeAssignee(
    @Param('id') taskId: string,
    @Param('userId') userId: string,
  ) {
    return this.tasksService.removeAssignee(taskId, userId);
  }
}
