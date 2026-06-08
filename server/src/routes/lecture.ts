import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { createMessage, extractJson } from '../utils/ai';
import { generateLectureReviewDocx } from '../utils/docx';
import { generateLectureReviewPdf } from '../utils/pdf';
import { saveFileToLocal, toPublicFileUrl } from '../routes/file';

const router = Router();
router.use(authMiddleware);

// 讲评课应有的 7 个核心字段(title 是从外层 lecture.title 拿,不算)
// 缺字段时用空值补,避免后续 docx/PDF 模板渲染时报 undefined
function parseLectureData(aiText: string): any | null {
  let data: any;
  try {
    data = extractJson<any>(aiText);
  } catch (e) {
    return null;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    console.warn(`[lecture] AI 返回不是对象: type=${Array.isArray(data) ? 'array' : typeof data}`);
    return null;
  }
  // 缺字段补默认值,保证 detail 页和 docx/PDF 模板有数据可读
  if (typeof data.overallSituation !== 'string') data.overallSituation = '';
  if (!Array.isArray(data.mainStrengths)) data.mainStrengths = [];
  if (!Array.isArray(data.commonProblems)) data.commonProblems = [];
  if (!Array.isArray(data.typicalProblemExplanation)) data.typicalProblemExplanation = [];
  if (!Array.isArray(data.excellentExpressions)) data.excellentExpressions = [];
  if (!Array.isArray(data.classPractice)) data.classPractice = [];
  if (!Array.isArray(data.afterClassSuggestions)) data.afterClassSuggestions = [];
  return data;
}

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
6. 严格输出 JSON,不要输出 Markdown
7. 【关键】必须输出一个 JSON **对象** {...},**绝对不能**是数组 [...]
   8 个字段都要齐:title / overallSituation / mainStrengths / commonProblems /
   typicalProblemExplanation / excellentExpressions / classPractice / afterClassSuggestions
8. 如果有信息不足,字段填空字符串或空数组,不要省略字段`;

    const userPrompt = `请基于以下作文批改批次结果生成讲评课方案:

作文主题:${summaryData.essayTopic}
批改人数:${summaryData.totalCount} 人
成功人数:${summaryData.successCount} 人
平均分:${avgScore} 分

学生作文结果汇总:
${JSON.stringify(summaryData.tasksSummary.slice(0, 10), null, 2)}

【重要】必须返回下面这种 JSON 对象(用 {...} 包裹),不能是数组 [...]:

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
}

只输出这一个 JSON 对象,不要 Markdown 围栏,不要解释,不要 <think> 标签。`;

    const aiText = await createMessage({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096,
      temperature: 0.3
    });

    let lectureData = parseLectureData(aiText);
    // 校验失败 → 调 repair prompt 让 AI 自修
    if (!lectureData) {
      console.warn(`[lecture] 首次 AI 返回格式异常,尝试 repair`);
      const repairText = await createMessage({
        system: '你是 JSON 格式修复器。必须输出严格合法的 JSON 对象 {...},不能是数组。所有 8 个字段必须存在。',
        messages: [{
          role: 'user',
          content: `把下面的讲评课输出整理为严格合法的 JSON 对象 {...}。

要求字段(必须全部存在,缺则填空字符串或空数组):
- title
- overallSituation
- mainStrengths (string[])
- commonProblems (string[])
- typicalProblemExplanation (object[]: {problem, reason, method})
- excellentExpressions (string[])
- classPractice (object[]: {exercise, guide, answer})
- afterClassSuggestions (string[])

上一次模型输出:
${aiText}

只输出这一个 JSON 对象,不要 Markdown 围栏,不要解释。`
        }],
        maxTokens: 4096,
        temperature: 0.1
      });
      lectureData = parseLectureData(repairText);
      if (!lectureData) {
        throw new Error('讲评课 AI 返回格式异常,repair 仍未修复成对象');
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

    // Generate Word + PDF document (PDF 失败不阻塞 docx)
    let wordUrl: string | null = null;
    let pdfUrl: string | null = null;
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
    try {
      const pdfBuffer = await generateLectureReviewPdf(lectureData, batch.batchName);
      const pdfSize = pdfBuffer.length;
      pdfUrl = await saveFileToLocal(`lecture_${lecture.id}`, pdfBuffer, 'pdf');
      await prisma.lectureReview.update({
        where: { id: lecture.id },
        data: { pdfUrl }
      });
      await prisma.generatedFile.create({
        data: {
          userId,
          sourceType: 'lecture_review',
          sourceId: lecture.id,
          fileName: `${lecture.title}.pdf`,
          fileType: 'pdf',
          fileUrl: pdfUrl!,
          fileSize: pdfSize
        }
      });
    } catch (err) {
      console.error('Failed to generate PDF:', err);
    }

    res.json({
      code: 0,
      data: {
        id: lecture.id,
        title: lecture.title,
        content: lectureData,
        wordUrl,
        pdfUrl
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
