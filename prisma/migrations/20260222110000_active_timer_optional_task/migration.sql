-- AlterTable: Allow ActiveTimer to be started without a task (assign task on stop)
ALTER TABLE "ActiveTimer" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "ActiveTimer" ALTER COLUMN "taskId" DROP NOT NULL;
