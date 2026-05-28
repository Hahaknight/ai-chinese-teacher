import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import Anthropic from '@anthropic-ai/sdk';

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

    const anthropic = new Anthropic();

    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241107',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: `你是一名语文老师，擅长给学生讲解病句修改。

请分析用户输入的句子，指出问题，并给出修改版本。

要求：
1. 说明原句有什么问题。
2. 给出一个自然、通顺、适合学生理解的修改版本。
3. 用简洁语言解释为什么这样修改。
4. 给出一个同类错误示例。
5. 输出严格 JSON，不要输出 Markdown。

返回格式：
{
  "originalSentence": "原句",
  "problemAnalysis": "问题分析",
  "fixedSentence": "修改版本",
  "explanation": "讲解说明",
  "similarExample": "同类示例"
}

原句：${sentence}`
      }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Invalid response from AI');
    }

    // Parse JSON response
    let result;
    try {
      result = JSON.parse(content.text);
    } catch {
      // Try to extract JSON from the response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response');
      }
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
        createdAt: r.createdAt.toISOString()
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;