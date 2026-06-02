import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { createMessage, extractJson } from '../utils/ai';
import { generateLectureReviewDocx } from '../utils/docx';
import { saveFileToLocal, toPublicFileUrl } from '../routes/file';

const router = Router();
router.use(authMiddleware);

// Generate lecture review
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { batchId } = req.body;
    const userId = req.userId!;

    if (!batchId) {
      res.status(400).json({ code: 400, message: 'batchId is required' });
      return;
    }

    const prisma = getPrisma();

    // Get batch with tasks
    const batch = await prisma.essayBatch.findFirst({
      where: { id: batchId, userId },
      include: { tasks: true }
    });

    if (!batch) {
      res.status(404).json({ code: 404, message: 'Batch not found' });
      return;
    }

    if (batch.tasks.length === 0) {
      res.status(400).json({ code: 400, message: 'No tasks in batch' });
      return;
    }

    // Prepare summary data for AI
    const successfulTasks = batch.tasks.filter(t => t.status === 'success');
    const totalScore = successfulTasks.reduce((sum, t) => sum + (t.score || 0), 0);
    const avgScore = successfulTasks.length > 0 ? (totalScore / successfulTasks.length).toFixed(1) : '0';

    const summaryData = {
      essayTopic: batch.batchName,
      reviewRequirement: batch.reviewRequirement,
      totalCount: batch.tasks.length,
      successCount: successfulTasks.length,
      avgScore,
      tasksSummary: successfulTasks.map(t => ({
        studentName: t.studentName,
        score: t.score,
        fullScore: t.fullScore,
        shortComment: t.shortComment,
        reviewResult: t.reviewResultJson ? JSON.parse(t.reviewResultJson) : null
      }))
    };

    // Call AI to generate lecture review
    const systemPrompt = `你是一名经验丰富的语文作文讲评课老师。基于学生作文批改结果生成讲评课方案。
要求:
1. 内容要适合老师课堂讲解
2. 重点提炼共性问题,不要逐个点评学生
3. 优秀表达可以做匿名化展示
4. 课堂练习要可操作、有针对性
5. 语言要清晰、有教学感
6. 严格输出 JSON,不要输出 Markdown`;

    const userPrompt = `请基于以下作文批改批次结果生成讲评课方案:

作文主题:${summaryData.essayTopic}
批改人数:${summaryData.totalCount} 人
成功人数:${summaryData.successCount} 人
平均分:${avgScore} 分

学生作文结果汇总:
${JSON.stringify(summaryData.tasksSummary.slice(0, 10), null, 2)}

返回格式:
{
  "title": "讲评课标题",
  "overallSituation": "整体情况概述(100-150字)",
  "mainStrengths": ["主要优点1", "主要优点2", "主要优点3"],
  "commonProblems": ["共性问题1", "共性问题2", "共性问题3"],
  "typicalProblemExplanation": [
    {"problem": "问题表现", "reason": "原因分析", "method": "修改方法"}
  ],
  "excellentExpressions": ["优秀表达1", "优秀表达2"],
  "classPractice": [
    {"exercise": "练习题", "guide": "修改引导", "answer": "参考答案"}
  ],
  "afterClassSuggestions": ["课后建议1", "课后建议2"]
}`;

    const aiText = await createMessage({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096
    });

    let lectureData;
    try {
      lectureData = extractJson(aiText);
    } catch (err: any) {
      throw new Error(`Failed to parse AI response: ${err.message}`);
    }

    // Create lecture review record
    const lecture = await prisma.lectureReview.create({
      data: {
        userId,
        batchId,
        title: lectureData.title || `《${batch.batchName}》作文讲评课`,
        content: JSON.stringify(lectureData)
      }
    });

    // Generate Word document
    let wordUrl = null;
    let fileSize = 0;
    try {
      const docxBuffer = await generateLectureReviewDocx(lectureData, batch.batchName);
      fileSize = docxBuffer.length;
      wordUrl = await saveFileToLocal(`lecture_${lecture.id}`, docxBuffer, 'docx');
      await prisma.lectureReview.update({
        where: { id: lecture.id },
        data: { wordUrl }
      });
      await prisma.generatedFile.create({
        data: {
          userId,
          sourceType: 'lecture_review',
          sourceId: lecture.id,
          fileName: `${lecture.title}.docx`,
          fileType: 'docx',
          fileUrl: wordUrl,
          fileSize
        }
      });
    } catch (err) {
      console.error('Failed to generate docx:', err);
    }

    res.json({
      code: 0,
      data: {
        id: lecture.id,
        title: lecture.title,
        content: lectureData,
        wordUrl,
        pdfUrl: lecture.pdfUrl
      }
    });
  } catch (err: any) {
    console.error('Generate lecture error:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get lecture reviews list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const lectures = await prisma.lectureReview.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({
      code: 0,
      data: lectures.map(l => ({
        id: l.id,
        batchId: l.batchId,
        title: l.title,
        wordUrl: toPublicFileUrl(l.wordUrl, req),
        pdfUrl: toPublicFileUrl(l.pdfUrl, req),
        createdAt: l.createdAt.toISOString()
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get lecture detail
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const lecture = await prisma.lectureReview.findFirst({
      where: { id, userId }
    });

    if (!lecture) {
      res.status(404).json({ code: 404, message: 'Lecture not found' });
      return;
    }

    res.json({
      code: 0,
      data: {
        id: lecture.id,
        batchId: lecture.batchId,
        title: lecture.title,
        content: JSON.parse(lecture.content),
        wordUrl: toPublicFileUrl(lecture.wordUrl, req),
        pdfUrl: toPublicFileUrl(lecture.pdfUrl, req),
        createdAt: lecture.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;
