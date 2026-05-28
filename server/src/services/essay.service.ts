import { getPrisma } from '../utils/db';
import Anthropic from '@anthropic-ai/sdk';
import { generateEssayReportDocx } from '../utils/docx';
import { v4 as uuidv4 } from 'uuid';

const anthropic = new Anthropic();

export async function processEssayTask(taskId: string, reviewRequirement: string): Promise<void> {
  const prisma = getPrisma();

  try {
    // Update task status to processing
    await prisma.essayTask.update({
      where: { id: taskId },
      data: { status: 'processing' }
    });

    // Get task with batch info
    const task = await prisma.essayTask.findUnique({
      where: { id: taskId },
      include: { batch: true }
    });

    if (!task) {
      throw new Error('Task not found');
    }

    const imageUrls = JSON.parse(task.imageUrls) as string[];

    // Build image content for AI
    const imageContents = [];
    for (const url of imageUrls) {
      imageContents.push({
        type: 'image' as const,
        source: {
          type: 'url' as const,
          url: url
        }
      });
    }

    // Call AI for essay review with vision
    const response = await anthropic.messages.create({
      model: 'claude-3-5-sonnet-20241107',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'text',
            text: `批改要求：
${reviewRequirement}

学生姓名：${task.studentName}

请根据上传的作文图片进行识别和批改。图片共 ${imageUrls.length} 张。

【请返回严格JSON格式，不要包含任何解释或markdown标记】

返回格式：
{
  "isReadable": true/false,
  "recognizedText": "识别出的作文正文",
  "score": {
    "total": 数字,
    "fullScore": 数字,
    "summary": "总分说明",
    "items": [
      {"name": "评分项名称", "score": 数字, "fullScore": 数字, "comment": "该项评价"}
    ]
  },
  "overallComment": "作文总评（200-300字）",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "problems": ["问题1", "问题2", "问题3"],
  "suggestions": ["建议1", "建议2", "建议3"],
  "improvedEssay": "【改良后的完整作文】",
  "shortTeacherComment": "【适合写在试卷上的简短评语，不超过50字】"
}

如果图片无法识别，请返回：
{
  "isReadable": false,
  "errorMessage": "具体说明无法识别的原因"
}`
          },
          ...imageContents
        ]
      }]
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Invalid response from AI');
    }

    let result;
    try {
      result = JSON.parse(content.text);
    } catch {
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        result = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error('Failed to parse AI response');
      }
    }

    if (!result.isReadable) {
      // Update task as failed
      await prisma.essayTask.update({
        where: { id: taskId },
        data: {
          status: 'failed',
          errorMessage: result.errorMessage || '图片无法识别'
        }
      });

      // Update batch counts
      await updateBatchCounts(task.batchId);
      return;
    }

    // Generate Word document
    let wordUrl = null;
    try {
      const docxBuffer = await generateEssayReportDocx({
        studentName: task.studentName,
        batchName: task.batch.batchName,
        reviewRequirement: task.batch.reviewRequirement,
        recognizedText: result.recognizedText,
        score: result.score,
        overallComment: result.overallComment,
        highlights: result.highlights,
        problems: result.problems,
        suggestions: result.suggestions,
        improvedEssay: result.improvedEssay,
        shortTeacherComment: result.shortTeacherComment
      });
      // In production, upload to COS and get URL
      wordUrl = '/files/essay_' + taskId + '_report.docx';
    } catch (err) {
      console.error('Failed to generate docx:', err);
    }

    // Update task with results
    await prisma.essayTask.update({
      where: { id: taskId },
      data: {
        status: 'success',
        score: result.score.total,
        fullScore: result.score.fullScore,
        recognizedText: result.recognizedText,
        reviewResultJson: JSON.stringify(result),
        shortComment: result.shortTeacherComment,
        wordUrl
      }
    });

    // Update batch counts
    await updateBatchCounts(task.batchId);

  } catch (err: any) {
    console.error('Process essay task error:', err);

    // Update task as failed
    await prisma.essayTask.update({
      where: { id: taskId },
      data: {
        status: 'failed',
        errorMessage: err.message || '处理失败'
      }
    });

    // Update batch counts
    const task = await prisma.essayTask.findUnique({ where: { id: taskId } });
    if (task) {
      await updateBatchCounts(task.batchId);
    }
  }
}

async function updateBatchCounts(batchId: string): Promise<void> {
  const prisma = getPrisma();

  const tasks = await prisma.essayTask.findMany({
    where: { batchId }
  });

  const totalCount = tasks.length;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const processingCount = tasks.filter(t => t.status === 'processing').length;

  let status = 'pending';
  if (processingCount > 0) {
    status = 'processing';
  } else if (successCount === totalCount) {
    status = 'completed';
  } else if (failedCount === totalCount) {
    status = 'failed';
  } else if (successCount > 0 || failedCount > 0) {
    status = 'partial';
  }

  await prisma.essayBatch.update({
    where: { id: batchId },
    data: { totalCount, successCount, failedCount, processingCount, status }
  });
}