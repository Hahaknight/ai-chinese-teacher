// 作文批改核心 service
// 默认走 minimax 直连(两步流水线:OCR → 批改)
// 通过环境变量 MINIMAX_DIRECT=0 切回 MCP + AI 两步模式(给已配 uvx 的环境保留)

import { getPrisma } from '../utils/db';
import { createMessage, imageFileToContent, extractJson, ChatMessage, ContentItem } from '../utils/ai';
import { generateEssayReportDocx } from '../utils/docx';
import { saveFileToLocal } from '../routes/file';
import { recognizeImage, downloadImage } from './imageRecognitionService';
import path from 'path';
import fs from 'fs';

const USE_DIRECT = process.env.MINIMAX_DIRECT !== '0';

export async function processEssayTask(taskId: string, reviewRequirement: string): Promise<void> {
  if (USE_DIRECT) {
    return processEssayTaskDirect(taskId, reviewRequirement);
  }
  return processEssayTaskWithMcp(taskId, reviewRequirement);
}

// ============ 新流程:两步流水线(默认) ============
// 第 1 步:每张图片单独 OCR 调用,返回纯文本(不要 JSON,避免 CJK 引号撑破 JSON 边界)
// 第 2 步:把所有页 OCR 文本拼起来,做批改,返回 JSON
// 解析失败:把畸形输出送回 AI 做 JSON 修复(repair pattern,参考 essay-correction-tool)
async function processEssayTaskDirect(taskId: string, reviewRequirement: string): Promise<void> {
  const prisma = getPrisma();

  try {
    await prisma.essayTask.update({
      where: { id: taskId },
      data: { status: 'processing' }
    });

    const task = await prisma.essayTask.findUnique({
      where: { id: taskId },
      include: { batch: true }
    });
    if (!task) throw new Error('Task not found');

    const imageUrls = JSON.parse(task.imageUrls) as string[];
    const tempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    // ============ 第 1 步:OCR 每张图片(逐张) ============
    const ocrTexts: string[] = [];
    const localPaths: string[] = [];

    for (let i = 0; i < imageUrls.length; i++) {
      const imagePath = path.join(tempDir, `essay_${taskId}_${i}.jpg`);
      console.log(`[essay:${taskId}] 下载图片 ${i + 1}/${imageUrls.length} from ${imageUrls[i]}`);
      try {
        await downloadImage(imageUrls[i], imagePath);
      } catch (err) {
        console.error(`Failed to download image ${i}:`, err);
        throw new Error(`图片下载失败: ${imageUrls[i]}`);
      }
      localPaths.push(imagePath);

      console.log(`[essay:${taskId}] OCR 第 ${i + 1}/${imageUrls.length} 页`);
      const ocrT0 = Date.now();
      const ocrContent: ContentItem[] = [
        { type: 'text', text: '识别图片中的作文文字,按原文输出,不要改写。保留标题、段落、标点和换行;如果有看不清的字,用 [?] 标记。只输出识别到的文字,不要输出思考过程、解释或 Markdown 标记。' },
        imageFileToContent(imagePath)
      ];
      let ocrText: string;
      try {
        ocrText = await createMessage({
          messages: [{ role: 'user', content: ocrContent }],
          maxTokens: 8192,
          temperature: 0.1,
          timeoutMs: 240000,
          responseFormat: 'none'
        });
      } catch (err: any) {
        console.error(`[essay:${taskId}] OCR 第 ${i + 1} 页失败,耗时 ${Date.now() - ocrT0}ms: ${err.message}`);
        throw new Error(`OCR 失败: ${err.message}`);
      }
      // 剥掉可能的 <think> 块
      ocrText = ocrText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();
      console.log(`[essay:${taskId}] OCR 第 ${i + 1} 页完成,耗时 ${Date.now() - ocrT0}ms,识别长度 ${ocrText.length}`);
      if (ocrText) {
        ocrTexts.push(imageUrls.length > 1 ? `【第${i + 1}页】\n${ocrText}` : ocrText);
      }
    }

    // 清理临时图片
    for (const p of localPaths) {
      try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
    }

    const recognizedText = ocrTexts.join('\n\n');
    if (!recognizedText || recognizedText.length < 20) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: 'OCR 返回为空或太短,无法识别作文内容' }
      });
      await updateBatchCounts(task.batchId);
      return;
    }

    // ============ 第 2 步:批改(文本输入,JSON 输出) ============
    const systemPrompt = `你是一名经验丰富的语文作文批改老师。
规则:
1. 如果批改要求包含明确评分标准,优先按用户提供的标准批改;否则使用默认 50 分制(立意 10、内容 15、结构 10、语言 10、卷面 5)。
2. 批改要具体,修改建议要可执行,改良后的作文保留学生原意。
3. 只输出严格合法 JSON,不要输出 Markdown、解释、思考过程或 <think> 标签。`;

    const userPrompt = `批改要求:
${reviewRequirement}

学生姓名:${task.studentName}

学生作文识别原文:
${recognizedText}

请按下面的 JSON 格式输出批改结果(不要 Markdown 围栏,不要解释文字):
{
  "isReadable": true,
  "recognizedText": "把学生作文原文转录到这里(如果有多页,保留分页标记和段落)",
  "score": {
    "total": 数字,
    "fullScore": 数字,
    "summary": "总分说明",
    "items": [{"name": "评分项名称", "score": 数字, "fullScore": 数字, "comment": "该项评价"}]
  },
  "overallComment": "作文总评(200-300字)",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "problems": ["问题1", "问题2", "问题3"],
  "suggestions": ["建议1", "建议2", "建议3"],
  "improvedEssay": "改良后的完整作文(保留学生原意)",
  "shortTeacherComment": "适合写在试卷上的简短评语,不超过50字"
}`;

    console.log(`[essay:${taskId}] 开始批改,OCR 文本长度 ${recognizedText.length}`);
    const correctT0 = Date.now();
    let aiText: string;
    try {
      aiText = await createMessage({
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        maxTokens: 12000,
        temperature: 0.3,
        timeoutMs: 300000,
        responseFormat: 'json_object'
      });
    } catch (err: any) {
      console.error(`[essay:${taskId}] 批改调用失败,耗时 ${Date.now() - correctT0}ms,错误: ${err.message}`);
      throw err;
    }
    console.log(`[essay:${taskId}] 批改调用成功,耗时 ${Date.now() - correctT0}ms,返回长度 ${aiText.length}`);

    // 解析 JSON;失败时调用 repair prompt 让 AI 自己修
    let result: any;
    try {
      result = extractJson<any>(aiText);
    } catch (parseErr: any) {
      console.warn(`[essay:${taskId}] 首次 JSON 解析失败,尝试 repair: ${parseErr.message}`);
      const repairPrompt = `请把下面的作文批改输出整理为严格合法 JSON。只输出 JSON,不要输出 Markdown、解释、思考过程或 <think>。

学生姓名:${task.studentName}
学生作文识别文本:
${recognizedText}

上一次模型输出(可能包含 JSON 语法错误,请修正):
${aiText}

必须输出如下格式:
{
  "isReadable": true,
  "recognizedText": "...",
  "score": {"total": 0, "fullScore": 0, "summary": "", "items": [{"name":"","score":0,"fullScore":0,"comment":""}]},
  "overallComment": "",
  "highlights": [],
  "problems": [],
  "suggestions": [],
  "improvedEssay": "",
  "shortTeacherComment": ""
}`;
      const repairT0 = Date.now();
      const repairText = await createMessage({
        system: '你是 JSON 格式修复器。只输出严格合法 JSON,不要输出思考过程、解释或 Markdown。',
        messages: [{ role: 'user', content: repairPrompt }],
        maxTokens: 12000,
        temperature: 0.1,
        timeoutMs: 240000,
        responseFormat: 'json_object'
      });
      console.log(`[essay:${taskId}] repair 调用成功,耗时 ${Date.now() - repairT0}ms,返回长度 ${repairText.length}`);
      result = extractJson<any>(repairText);
    }

    if (!result.isReadable) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: result.errorMessage || '作文无法识别' }
      });
      await updateBatchCounts(task.batchId);
      return;
    }

    // 生成 Word 报告
    let wordUrl: string | null = null;
    let fileSize = 0;
    try {
      const docxBuffer = await generateEssayReportDocx({
        studentName: task.studentName,
        batchName: task.batch.batchName,
        reviewRequirement: task.batch.reviewRequirement,
        recognizedText: result.recognizedText || recognizedText,
        score: result.score,
        overallComment: result.overallComment,
        highlights: result.highlights,
        problems: result.problems,
        suggestions: result.suggestions,
        improvedEssay: result.improvedEssay,
        shortTeacherComment: result.shortTeacherComment
      });
      fileSize = docxBuffer.length;
      wordUrl = await saveFileToLocal(`essay_${task.studentName}_${taskId}`, docxBuffer, 'docx');
    } catch (err) {
      console.error('Failed to generate docx:', err);
    }

    await prisma.essayTask.update({
      where: { id: taskId },
      data: {
        status: 'success',
        score: result.score?.total ?? 0,
        fullScore: result.score?.fullScore ?? 0,
        recognizedText: result.recognizedText || recognizedText,
        reviewResultJson: JSON.stringify(result),
        shortComment: result.shortTeacherComment,
        wordUrl
      }
    });

    if (wordUrl) {
      await prisma.generatedFile.create({
        data: {
          userId: task.userId,
          sourceType: 'essay_report',
          sourceId: taskId,
          fileName: `${task.studentName}_作文批改报告.docx`,
          fileType: 'docx',
          fileUrl: wordUrl,
          fileSize
        }
      });
    }

    await updateBatchCounts(task.batchId);

  } catch (err: any) {
    console.error('Process essay task (direct) error:', err);
    await markTaskFailed(taskId, err.message || '处理失败');
  }
}

// ============ 老流程:MCP 识别 + AI 批改(MINIMAX_DIRECT=0 启用) ============
async function processEssayTaskWithMcp(taskId: string, reviewRequirement: string): Promise<void> {
  const prisma = getPrisma();

  try {
    await prisma.essayTask.update({
      where: { id: taskId },
      data: { status: 'processing' }
    });

    const task = await prisma.essayTask.findUnique({
      where: { id: taskId },
      include: { batch: true }
    });
    if (!task) throw new Error('Task not found');

    const imageUrls = JSON.parse(task.imageUrls) as string[];
    const tempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    const recognizedTexts: string[] = [];
    for (let i = 0; i < imageUrls.length; i++) {
      const imagePath = path.join(tempDir, `essay_${taskId}_${i}.jpg`);
      try {
        await downloadImage(imageUrls[i], imagePath);
      } catch (err) {
        console.error(`Failed to download image ${i}:`, err);
        throw new Error(`图片下载失败: ${imageUrls[i]}`);
      }

      try {
        const text = await recognizeImage(imagePath);
        recognizedTexts.push(text);
      } catch (err) {
        console.error(`Failed to recognize image ${i}:`, err);
        throw new Error('图片识别失败');
      } finally {
        if (fs.existsSync(imagePath)) {
          try { fs.unlinkSync(imagePath); } catch (_) { /* ignore */ }
        }
      }
    }

    const recognizedText = recognizedTexts.join('\n\n');

    const systemPrompt = `你是一名经验丰富的语文作文批改老师。
规则:
1. 如果批改要求包含明确评分标准,优先按用户提供的标准批改;否则使用默认 50 分制(立意 10、内容 15、结构 10、语言 10、卷面 5)。
2. 批改要具体,修改建议要可执行,改良后的作文保留学生原意。
3. 严格输出 JSON,不要输出 Markdown。`;

    const userPrompt = `批改要求:
${reviewRequirement}

学生姓名:${task.studentName}

识别出的作文原文:
${recognizedText}

【请返回严格 JSON 格式,不要包含任何解释或 markdown 标记】

返回格式:
{
  "isReadable": true/false,
  "recognizedText": "识别出的作文正文",
  "score": {"total": 数字, "fullScore": 数字, "summary": "总分说明", "items": [{"name": "评分项名称", "score": 数字, "fullScore": 数字, "comment": "该项评价"}]},
  "overallComment": "作文总评(200-300字)",
  "highlights": ["亮点1", "亮点2", "亮点3"],
  "problems": ["问题1", "问题2", "问题3"],
  "suggestions": ["建议1", "建议2", "建议3"],
  "improvedEssay": "【改良后的完整作文】",
  "shortTeacherComment": "【适合写在试卷上的简短评语,不超过50字】"
}`;

    const aiText = await createMessage({
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 4096
    });
    const result = extractJson<any>(aiText);

    if (!result.isReadable) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: result.errorMessage || '图片无法识别' }
      });
      await updateBatchCounts(task.batchId);
      return;
    }

    let wordUrl: string | null = null;
    let fileSize = 0;
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
      fileSize = docxBuffer.length;
      wordUrl = await saveFileToLocal(`essay_${task.studentName}_${taskId}`, docxBuffer, 'docx');
    } catch (err) {
      console.error('Failed to generate docx:', err);
    }

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

    if (wordUrl) {
      await prisma.generatedFile.create({
        data: {
          userId: task.userId,
          sourceType: 'essay_report',
          sourceId: taskId,
          fileName: `${task.studentName}_作文批改报告.docx`,
          fileType: 'docx',
          fileUrl: wordUrl,
          fileSize
        }
      });
    }

    await updateBatchCounts(task.batchId);

  } catch (err: any) {
    console.error('Process essay task (mcp) error:', err);
    await markTaskFailed(taskId, err.message || '处理失败');
  }
}

async function markTaskFailed(taskId: string, message: string) {
  const prisma = getPrisma();
  await prisma.essayTask.update({
    where: { id: taskId },
    data: { status: 'failed', errorMessage: message }
  });
  const task = await prisma.essayTask.findUnique({ where: { id: taskId } });
  if (task) await updateBatchCounts(task.batchId);
}

async function updateBatchCounts(batchId: string): Promise<void> {
  const prisma = getPrisma();

  const tasks = await prisma.essayTask.findMany({ where: { batchId } });

  const totalCount = tasks.length;
  const successCount = tasks.filter(t => t.status === 'success').length;
  const failedCount = tasks.filter(t => t.status === 'failed').length;
  const processingCount = tasks.filter(t => t.status === 'processing').length;

  let status = 'pending';
  if (processingCount > 0) {
    status = 'processing';
  } else if (successCount === totalCount && totalCount > 0) {
    status = 'completed';
  } else if (failedCount === totalCount && totalCount > 0) {
    status = 'failed';
  } else if (successCount > 0 || failedCount > 0) {
    status = 'partial';
  }

  await prisma.essayBatch.update({
    where: { id: batchId },
    data: { totalCount, successCount, failedCount, processingCount, status }
  });
}
