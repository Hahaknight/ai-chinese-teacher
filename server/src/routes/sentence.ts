import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import { createMessage, extractJson } from '../utils/ai';

const router = Router();
router.use(authMiddleware);

// Sentence fix
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { sentence } = req.body;
    const userId = req.userId!;

    if (!sentence) {
      res.status(400).json({ code: 400, message: 'sentence is required' });
      return;
    }

    const systemPrompt = `你是一名语文老师,擅长给学生讲解病句修改。
要求:
1. 说明原句有什么问题。
2. 给出一个自然、通顺、适合学生理解的修改版本。
3. 用简洁语言解释为什么这样修改。
4. 给出一个同类错误示例。
5. 严格输出 JSON,不要输出 Markdown。`;

    const userPrompt = `原句:${sentence}

返回格式:
{
  "originalSentence": "原句",
  "problemAnalysis": "问题分析",
  "fixedSentence": "修改版本",
  "explanation": "讲解说明",
  "similarExample": "同类示例"
}`;

    const aiText = await createMessage({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1024
    });

    let result;
    try {
      result = extractJson(aiText);
    } catch (err: any) {
      throw new Error(`Failed to parse AI response: ${err.message}`);
    }

    // Save record
    const prisma = getPrisma();
    const record = await prisma.sentenceFixRecord.create({
      data: {
        userId,
        originalSentence: result.originalSentence || sentence,
        problemAnalysis: result.problemAnalysis,
        fixedSentence: result.fixedSentence,
        explanation: result.explanation,
        similarExample: result.similarExample,
        resultJson: JSON.stringify(result)
      }
    });

    res.json({
      code: 0,
      data: {
        id: record.id,
        ...result
      }
    });
  } catch (err: any) {
    console.error('Sentence fix error:', err);
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get history
router.get('/history', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const records = await prisma.sentenceFixRecord.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    res.json({
      code: 0,
      data: records.map(r => ({
        id: r.id,
        originalSentence: r.originalSentence,
        problemAnalysis: r.problemAnalysis,
        fixedSentence: r.fixedSentence,
        explanation: r.explanation,
        similarExample: r.similarExample,
        createdAt: r.createdAt.toISOString()
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get single record (供 history 列表点击回看)
router.get('/records/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const r = await prisma.sentenceFixRecord.findFirst({ where: { id, userId } });
    if (!r) {
      res.status(404).json({ code: 404, message: 'Record not found' });
      return;
    }

    res.json({
      code: 0,
      data: {
        id: r.id,
        originalSentence: r.originalSentence,
        problemAnalysis: r.problemAnalysis,
        fixedSentence: r.fixedSentence,
        explanation: r.explanation,
        similarExample: r.similarExample,
        createdAt: r.createdAt.toISOString()
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;