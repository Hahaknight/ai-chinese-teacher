import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { processEssayTask } from '../services/essay.service';
import { toPublicFileUrl } from './file';

const router = Router();

// Apply auth middleware to all routes
router.use(authMiddleware);

// Create batch
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { batchName, reviewRequirement } = req.body;
    const userId = req.userId!;

    if (!batchName || !reviewRequirement) {
      res.status(400).json({ code: 400, message: 'batchName and reviewRequirement are required' });
      return;
    }

    const prisma = getPrisma();
    const batch = await prisma.essayBatch.create({
      data: {
        userId,
        batchName,
        reviewRequirement,
        status: 'pending'
      }
    });

    res.json({
      code: 0,
      data: {
        id: batch.id,
        batchName: batch.batchName,
        status: batch.status,
        totalCount: batch.totalCount,
        successCount: batch.successCount,
        failedCount: batch.failedCount,
        processingCount: batch.processingCount,
        createdAt: batch.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    console.error('Create batch error:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get batch list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const batches = await prisma.essayBatch.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 20
    });

    res.json({
      code: 0,
      data: batches.map(b => ({
        id: b.id,
        batchName: b.batchName,
        status: b.status,
        totalCount: b.totalCount,
        successCount: b.successCount,
        failedCount: b.failedCount,
        createdAt: b.createdAt.toISOString()
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get recent batches
router.get('/recent', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const batches = await prisma.essayBatch.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
      take: 5,
      include: {
        tasks: {
          select: { id: true }
        }
      }
    });

    res.json({
      code: 0,
      data: batches.map(b => {
        const statusText = b.status === 'completed' ? '已完成' :
                          b.status === 'processing' ? '批改中' :
                          b.status === 'partial' ? '部分完成' : '待批改';
        return {
          id: b.id,
          batchName: b.batchName,
          statusText,
          studentCount: b.tasks.length
        };
      })
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get batch detail
router.get('/:batchId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const batch = await prisma.essayBatch.findFirst({
      where: { id: batchId, userId },
      include: {
        tasks: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!batch) {
      res.status(404).json({ code: 404, message: 'Batch not found' });
      return;
    }

    res.json({
      code: 0,
      data: {
        id: batch.id,
        batchName: batch.batchName,
        reviewRequirement: batch.reviewRequirement,
        status: batch.status,
        totalCount: batch.totalCount,
        successCount: batch.successCount,
        failedCount: batch.failedCount,
        processingCount: batch.processingCount,
        createdAt: batch.createdAt.toISOString(),
        updatedAt: batch.updatedAt.toISOString(),
        tasks: batch.tasks.map(t => ({
          id: t.id,
          studentName: t.studentName,
          imageCount: t.imageCount,
          status: t.status,
          score: t.score,
          fullScore: t.fullScore,
          wordUrl: toPublicFileUrl(t.wordUrl, req),
          pdfUrl: toPublicFileUrl(t.pdfUrl, req),
          errorMessage: t.errorMessage
        }))
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Delete batch
router.delete('/:batchId([0-9a-fA-F-]{36})', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    await prisma.essayBatch.deleteMany({
      where: { id: batchId, userId }
    });

    res.json({ code: 0, message: 'Batch deleted' });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Add student task
router.post('/:batchId/tasks', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const { studentName, imageUrls } = req.body;
    const userId = req.userId!;

    if (!studentName || !Array.isArray(imageUrls) || imageUrls.length === 0) {
      res.status(400).json({ code: 400, message: 'studentName and imageUrls are required' });
      return;
    }

    if (imageUrls.length > 3) {
      res.status(400).json({ code: 400, message: 'Maximum 3 images per student' });
      return;
    }

    const prisma = getPrisma();

    // Verify batch exists and belongs to user
    const batch = await prisma.essayBatch.findFirst({
      where: { id: batchId, userId }
    });

    if (!batch) {
      res.status(404).json({ code: 404, message: 'Batch not found' });
      return;
    }

    const task = await prisma.essayTask.create({
      data: {
        batchId,
        userId,
        studentName,
        imageUrls: JSON.stringify(imageUrls),
        imageCount: imageUrls.length,
        status: 'pending'
      }
    });

    // Update batch total count
    await prisma.essayBatch.update({
      where: { id: batchId },
      data: { totalCount: { increment: 1 } }
    });

    res.json({
      code: 0,
      data: {
        taskId: task.id,
        batchId: task.batchId,
        studentName: task.studentName,
        imageCount: task.imageCount,
        status: task.status
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get batch tasks
router.get('/:batchId/tasks', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const tasks = await prisma.essayTask.findMany({
      where: { batchId, userId },
      orderBy: { createdAt: 'asc' }
    });

    res.json({
      code: 0,
      data: tasks.map(t => ({
        id: t.id,
        studentName: t.studentName,
        imageCount: t.imageCount,
        status: t.status,
        score: t.score,
        fullScore: t.fullScore,
          wordUrl: toPublicFileUrl(t.wordUrl, req),
          pdfUrl: toPublicFileUrl(t.pdfUrl, req),
          errorMessage: t.errorMessage
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Start batch processing
router.post('/:batchId/start', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    // Get batch and tasks
    const batch = await prisma.essayBatch.findFirst({
      where: { id: batchId, userId },
      include: { tasks: true }
    });

    if (!batch) {
      res.status(404).json({ code: 404, message: 'Batch not found' });
      return;
    }

    if (batch.tasks.length === 0) {
      res.status(400).json({ code: 400, message: 'No tasks to process' });
      return;
    }

    // Update batch status
    await prisma.essayBatch.update({
      where: { id: batchId },
      data: { status: 'processing', processingCount: batch.tasks.length }
    });

    // Process each task asynchronously
    batch.tasks.forEach(async (task) => {
      await processEssayTask(task.id, batch.reviewRequirement);
    });

    res.json({
      code: 0,
      data: {
        batchId: batch.id,
        status: 'processing',
        message: `批改任务已开始，共 ${batch.tasks.length} 个任务`
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get task detail / report
router.get('/tasks/:taskId', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const task = await prisma.essayTask.findFirst({
      where: { id: taskId, userId }
    });

    if (!task) {
      res.status(404).json({ code: 404, message: 'Task not found' });
      return;
    }

    const batch = await prisma.essayBatch.findFirst({
      where: { id: task.batchId, userId }
    });

    res.json({
      code: 0,
      data: {
        id: task.id,
        studentName: task.studentName,
        status: task.status,
        recognizedText: task.recognizedText,
        reviewResult: task.reviewResultJson ? JSON.parse(task.reviewResultJson) : null,
        shortComment: task.shortComment,
        imageUrls: task.imageUrls,
        wordUrl: toPublicFileUrl(task.wordUrl, req),
        pdfUrl: toPublicFileUrl(task.pdfUrl, req),
        score: task.score,
        fullScore: task.fullScore,
        errorMessage: task.errorMessage,
        batchName: batch?.batchName,
        reviewRequirement: batch?.reviewRequirement,
        createdAt: task.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Retry failed task
router.post('/tasks/:taskId/retry', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const { imageUrls } = req.body;
    const userId = req.userId!;
    const prisma = getPrisma();

    const task = await prisma.essayTask.findFirst({
      where: { id: taskId, userId },
      include: { batch: true }
    });

    if (!task) {
      res.status(404).json({ code: 404, message: 'Task not found' });
      return;
    }

    // Update task with new images if provided
    if (imageUrls && imageUrls.length > 0) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: {
          imageUrls: JSON.stringify(imageUrls),
          imageCount: imageUrls.length,
          status: 'pending',
          errorMessage: null
        }
      });
    } else {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'pending', errorMessage: null }
      });
    }

    // Process task
    await processEssayTask(taskId, task.batch.reviewRequirement);

    res.json({
      code: 0,
      data: {
        taskId: task.id,
        status: 'processing'
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
