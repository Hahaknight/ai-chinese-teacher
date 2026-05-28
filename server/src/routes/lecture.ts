import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import Anthropic from '@anthropic-ai/sdk';
import { generateLectureReviewDocx } from '../utils/docx';

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
    const anthropic = new Anthropic();
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241107',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `你是一名经验丰富的语文作文讲评课老师。

请基于以下作文批改批次结果生成讲评课方案：

作文主题：${summaryData.essayTopic}
批改人数：${summaryData.totalCount} 人
成功人数：${summaryData.successCount} 人
平均分：${avgScore} 分

学生作文结果汇总：
${JSON.stringify(summaryData.tasksSummary.slice(0, 10), null, 2)}

要求：
1. 内容要适合老师课堂讲解
2. 重点提炼共性问题，不要逐个点评学生
3. 优秀表达可以做匿名化展示
4. 课堂练习要可操作、有针对性
5. 语言要清晰、有教学感
6. 输出严格 JSON，不要输出 Markdown

返回格式：
{
  "title": "讲评课标题",
  "overallSituation": "整体情况概述（100-150字）",
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
}`
      }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Invalid response from AI');
    }

    let lectureData;
    try {
      lectureData = JSON.parse(content.text);
    } catch {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        lectureData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response');
      }
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
    try {
      const docxBuffer = await generateLectureReviewDocx(lectureData, batch.batchName);
      // In production, upload to COS and save URL
      lecture.wordUrl = '/files/lecture_' + lecture.id + '.docx';
    } catch (err) {
      console.error('Failed to generate docx:', err);
    }

    res.json({
      code: 0,
      data: {
        id: lecture.id,
        title: lecture.title,
        content: lectureData,
        wordUrl: lecture.wordUrl,
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
        wordUrl: l.wordUrl,
        pdfUrl: l.pdfUrl,
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
        wordUrl: lecture.wordUrl,
        pdfUrl: lecture.pdfUrl,
        createdAt: lecture.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;