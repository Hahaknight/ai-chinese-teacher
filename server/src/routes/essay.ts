import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { processEssayTask } from '../services/essay.service';
import { toPublicFileUrl } from './file';
import { createEssayLimiter } from '../utils/concurrency';

const router = Router();

// 整个模块共享同一个 limiter:start 跑 X 个 + retry 跑 Y 个时,总并发不会超过 cap
// cap 默认从 env ESSAY_MAX_CONCURRENT 读(部署在 ecosystem.config.cjs),缺省 3
const essayLimit = createEssayLimiter();

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
          nameMissing: !t.studentName,
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

    if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
      res.status(400).json({ code: 400, message: 'imageUrls is required' });
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

    // 异步并发批改:Promise.allSettled 兜底,任一任务异常不会丢日志
    // 不 await 这个 Promise,让 HTTP 响应立即返回(老师按"开始批改"后页面继续走轮询)
    // 用 essayLimit 控制并发:1.7G 内存下 Puppeteer Chromium + 13 个并发 task 会触发
    // minimax 平台 QPS 限流 / Node 内存膨胀;ESSAY_MAX_CONCURRENT=3 是经过计算的甜蜜点
    Promise.allSettled(
      batch.tasks.map((task) =>
        essayLimit(() => processEssayTask(task.id, batch.reviewRequirement))
      )
    ).then((results) => {
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') {
          console.log(`[batch:${batchId}] 进度 ${i + 1}/${results.length} 完成`);
        } else {
          console.error(`[batch:${batchId}] 进度 ${i + 1}/${results.length} 异常:`, r.reason);
        }
      });
      const failed = results.filter((r) => r.status === 'rejected').length;
      console.log(
        `[batch:${batchId}] 全部任务结算: ${results.length} 个, 异常 ${failed} 个, 并发上限 ${process.env.ESSAY_MAX_CONCURRENT || '3'}`
      );
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

    // 姓名未识别时,返回候选名单(从 OCR 文本前 500 字中提取 2-4 字中文片段)
    const { extractNameCandidates } = await import('../services/essay.service');
    const nameCandidates = !task.studentName && task.recognizedText
      ? extractNameCandidates(task.recognizedText, 5)
      : [];

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
        nameCandidates,
        nameMissing: !task.studentName,
        createdAt: task.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// 只更新学生姓名(不重跑批改),用于老师在前端点选候选名后快速补全
router.patch('/tasks/:taskId/name', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const { studentName } = req.body;
    const userId = req.userId!;
    const prisma = getPrisma();

    if (typeof studentName !== 'string') {
      res.status(400).json({ code: 400, message: 'studentName 必须是字符串' });
      return;
    }
    const trimmed = studentName.trim();
    if (trimmed.length === 0) {
      res.status(400).json({ code: 400, message: 'studentName 不能为空' });
      return;
    }
    if (trimmed.length > 20) {
      res.status(400).json({ code: 400, message: 'studentName 太长' });
      return;
    }

    const task = await prisma.essayTask.findFirst({
      where: { id: taskId, userId },
      select: { id: true }
    });
    if (!task) {
      res.status(404).json({ code: 404, message: 'Task not found' });
      return;
    }

    await prisma.essayTask.update({
      where: { id: taskId },
      data: { studentName: trimmed }
    });

    res.json({
      code: 0,
      data: { taskId, studentName: trimmed }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Retry failed task
router.post('/tasks/:taskId/retry', async (req: AuthRequest, res: Response) => {
  try {
    const { taskId } = req.params;
    const { imageUrls, studentName } = req.body;
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

    // 合并 update:新图片 / 新姓名 / 重置状态
    // studentName 只有非空时才覆盖(允许前端 OCR 后改名,跟原值共存)
    const updateData: any = { status: 'pending', errorMessage: null };
    if (imageUrls && imageUrls.length > 0) {
      updateData.imageUrls = JSON.stringify(imageUrls);
      updateData.imageCount = imageUrls.length;
    }
    if (studentName !== undefined && studentName !== '') {
      updateData.studentName = studentName;
    }
    await prisma.essayTask.update({
      where: { id: taskId },
      data: updateData
    });

    // 异步执行批改(不 await,HTTP 立即返回)—— 跟 batch start 接口保持一致,
    // 避免 OCR + 批改 1-2 分钟把 HTTP 连接卡住导致前端超时
    // 走同一个 essayLimit:即使老师在 batch 跑的同时点 retry,总并发不会超过 cap
    essayLimit(() => processEssayTask(taskId, task.batch.reviewRequirement))
      .catch(err => console.error(`[essay-retry:${taskId}] 处理失败:`, err));

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
