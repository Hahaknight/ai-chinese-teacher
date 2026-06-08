// 作文批改核心 service
// 走直连 minimax 端点,两种 OCR 流程(批改/落库逻辑共享):
//   - 一步 OCR(MINIMAX_DIRECT=0,**默认**):每张图调 recognizeImage (/coding_plan/vlm) → 文本
//   - 两步流水线(MINIMAX_DIRECT=1):每张图独立调 createMessage + image content → 文本
//
// ⚠️ 2026-06-08 实测:M2.7 在 /v1/chat/completions 上不接受 image_url content(API 不报错但静默丢图,
//    prompt_tokens 只有 92,模型自己 think 一通后说"请提供图片")。所以两步流水线对 M2.7 等于
//    空跑,默认必须走 /coding_plan/vlm 才能拿到真实 OCR。
//    .env 里 MINIMAX_DIRECT=1 是个历史遗留的坏默认值,新装环境别再设了。
//
// OCR 模型固定 M2.7(M3 在 OCR 场景幻觉,见 2026-06-03 实测;
// utils/ai.ts 里 hasImageContent 检测后会强制覆盖);
// 批改模型走 utils/ai.ts 的 MODEL/FALLBACK_MODEL(默认 M3 + M2.7 fallback)。

import { getPrisma } from '../utils/db';
import { createMessage, imageFileToContent, extractJson, ContentItem } from '../utils/ai';
import { generateEssayReportDocx } from '../utils/docx';
import { generateEssayReportPdf } from '../utils/pdf';
import { cleanupTaskTempFiles } from '../utils/cleanup';
import { saveFileToLocal } from '../routes/file';
import { recognizeImage, downloadImage } from './imageRecognitionService';
import path from 'path';
import fs from 'fs';

// MINIMAX_DIRECT=0 走 coding_plan/vlm(**默认**,实测能用);
// =1 走 chat/completions + image_url(M2.7 在该端点不接受图片,会返空,不要开)
const USE_TWO_STEP = process.env.MINIMAX_DIRECT === '1';

// 常见模板/排除词(OCR 文本里会反复出现,不能当姓名)
const NAME_STOP_WORDS = new Set([
  // 学科
  '语文', '数学', '英语', '物理', '化学', '生物', '政治', '历史', '地理', '道德', '法治',
  // 答题卡模板
  '答题', '答题卡', '答案', '班级', '学号', '姓名', '学生', '学校', '年级', '考场', '座号',
  // 作文相关
  '题目', '作文', '写作', '阅读', '理解', '练习', '测试', '考试', '模拟', '期中', '期末', '中考', '高考',
  // 模板短语
  '不能超出', '黑色边框', '限定区域', '否则', '无效', '请不要', '在此区域', '任何标记',
  // 常见作文标题(高频误识)
  '失败', '成功', '那年', '青春', '那一刻', '那一次', '一种', '我的', '你的', '他的',
  '记一次', '一次', '难忘', '成长', '母爱', '父爱', '友谊', '故乡', '家乡'
]);

function isPlausibleName(s: string): boolean {
  if (!s) return false;
  if (!/^[一-龥]{2,4}$/.test(s)) return false;
  if (NAME_STOP_WORDS.has(s)) return false;
  return true;
}

// 从 OCR 文本中提取学生姓名,多策略兜底
export function extractStudentNameFromText(text: string): string {
  if (!text) return '';
  const head = text.slice(0, 300);

  // 策略 1: 显式 "姓名:XXX" / "姓名_XXX" / "学生姓名:XXX"
  const labelRe = /(?:^|\n)\s*(?:学生\s*)?姓\s*名\s*[:：_—\-]+\s*([^\s班级学号,，。]{1,5})/u;
  const m1 = head.match(labelRe);
  if (m1 && isPlausibleName(m1[1].trim())) return m1[1].trim();

  // 策略 2: 第一行(取到第一个换行)开头 2-4 字中文
  const firstLine = (head.split('\n')[0] || '').trim();
  const startRe = /^([一-龥]{2,4})(?:\s|$|[^一-龥])/;
  const m2 = firstLine.match(startRe);
  if (m2 && isPlausibleName(m2[1])) return m2[1];

  // 策略 3: 作文里自报姓名
  const bodyRe = /(?:我叫|我是|本人是|吾名|名字叫)\s*([一-龥]{2,4})/u;
  const m3 = text.match(bodyRe);
  if (m3 && isPlausibleName(m3[1])) return m3[1];

  return '';
}

// 从 OCR 文本中提取 3-5 个姓名候选(用于前端"快速选择"下拉)
export function extractNameCandidates(text: string, maxCount = 5): string[] {
  if (!text) return [];
  const head = text.slice(0, 500);
  const re = /(^|\s|[^一-龥])([一-龥]{2,4})(?=\s|$|[^一-龥])/g;
  const counts = new Map<string, { count: number; firstPos: number }>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(head)) !== null) {
    const candidate = m[2];
    if (!isPlausibleName(candidate)) continue;
    const existing = counts.get(candidate);
    if (existing) {
      existing.count++;
    } else {
      counts.set(candidate, { count: 1, firstPos: m.index });
    }
  }
  const sorted = Array.from(counts.entries())
    .sort((a, b) => {
      if (b[1].count !== a[1].count) return b[1].count - a[1].count;
      return a[1].firstPos - b[1].firstPos;
    })
    .map(([name]) => name);
  return sorted.slice(0, maxCount);
}

function getTempDir(): string {
  const tempDir = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
  if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
  return tempDir;
}

// ============ OCR 步骤(两套实现,选其一)============

// 两步流水线 OCR:走 createMessage + image_url,M2.7 在 utils/ai.ts 里被强制
async function ocrViaCreateMessage(taskId: string, imagePath: string, pageIdx: number, totalPages: number): Promise<string> {
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
    console.error(`[essay:${taskId}] OCR 第 ${pageIdx + 1} 页失败,耗时 ${Date.now() - ocrT0}ms: ${err.message}`);
    throw new Error(`OCR 失败: ${err.message}`);
  }
  // 剥掉可能的 <think> 块
  ocrText = ocrText.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();
  console.log(`[essay:${taskId}] OCR(createMessage) 第 ${pageIdx + 1}/${totalPages} 页完成,耗时 ${Date.now() - ocrT0}ms,长度 ${ocrText.length}`);
  return ocrText;
}

// 一步 OCR:走 recognizeImage(/coding_plan/vlm)
async function ocrViaVlmEndpoint(taskId: string, imagePath: string, pageIdx: number, totalPages: number): Promise<string> {
  const ocrT0 = Date.now();
  try {
    const text = await recognizeImage(imagePath);
    console.log(`[essay:${taskId}] OCR(vlm) 第 ${pageIdx + 1}/${totalPages} 页完成,耗时 ${Date.now() - ocrT0}ms,长度 ${text.length}`);
    return text;
  } catch (err: any) {
    console.error(`[essay:${taskId}] OCR(vlm) 第 ${pageIdx + 1} 页失败:`, err);
    throw new Error('图片识别失败');
  }
}

// 下载图片 + OCR + 临时图清理(由 OCR 引擎决定)
async function downloadAndOcr(
  taskId: string,
  imageUrls: string[],
  ocrEngine: (taskId: string, imagePath: string, pageIdx: number, total: number) => Promise<string>
): Promise<string[]> {
  const tempDir = getTempDir();
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

    const text = await ocrEngine(taskId, imagePath, i, imageUrls.length);
    if (text) {
      // 多张图加【第X页】标记,让批改 AI 能区分
      ocrTexts.push(imageUrls.length > 1 ? `【第${i + 1}页】\n${text}` : text);
    }
  }

  // 清理临时图(失败路径在外层 catch 也会再清一次,无害)
  for (const p of localPaths) {
    try { fs.unlinkSync(p); } catch (_) { /* ignore */ }
  }

  return ocrTexts;
}

// ============ 批改步骤(共享)============

interface GradeResult {
  isReadable: boolean;
  recognizedText?: string;
  score?: { total: number; fullScore: number; summary: string; items: any[] };
  overallComment?: string;
  highlights?: string[];
  problems?: string[];
  suggestions?: string[];
  improvedEssay?: string;
  shortTeacherComment?: string;
  errorMessage?: string;
}

async function gradeEssay(
  taskId: string,
  studentName: string | null,
  reviewRequirement: string,
  recognizedText: string
): Promise<GradeResult> {
  const systemPrompt = `你是一名经验丰富的语文作文批改老师。
规则:
1. 如果批改要求包含明确评分标准,优先按用户提供的标准批改;否则使用默认 50 分制(立意 10、内容 15、结构 10、语言 10、卷面 5)。
2. 批改要具体,修改建议要可执行,改良后的作文保留学生原意。
3. 只输出严格合法 JSON,不要输出 Markdown、解释、思考过程或 <think> 标签。`;

  const userPrompt = `批改要求:
${reviewRequirement}

学生姓名:${studentName || '未命名'}

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
  const aiText = await createMessage({
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
    maxTokens: 12000,
    temperature: 0.3,
    timeoutMs: 300000,
    responseFormat: 'json_object'
  });
  console.log(`[essay:${taskId}] 批改调用成功,耗时 ${Date.now() - correctT0}ms,返回长度 ${aiText.length}`);

  // 解析 JSON;失败时调用 repair prompt 让 AI 自己修
  try {
    return extractJson<GradeResult>(aiText);
  } catch (parseErr: any) {
    console.warn(`[essay:${taskId}] 首次 JSON 解析失败,尝试 repair: ${parseErr.message}`);
    const repairPrompt = `请把下面的作文批改输出整理为严格合法 JSON。只输出 JSON,不要输出 Markdown、解释、思考过程或 <think>。

学生姓名:${studentName || '未命名'}
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
    return extractJson<GradeResult>(repairText);
  }
}

// ============ 落库步骤:生成 docx/pdf + 写 DB(共享)============

async function persistReport(
  taskId: string,
  studentName: string | null,
  batchName: string,
  reviewRequirement: string,
  recognizedText: string,
  result: GradeResult
): Promise<void> {
  const prisma = getPrisma();
  const reportInput = {
    studentName,
    batchName,
    reviewRequirement,
    recognizedText: result.recognizedText || recognizedText,
    score: result.score!,
    overallComment: result.overallComment || '',
    highlights: result.highlights || [],
    problems: result.problems || [],
    suggestions: result.suggestions || [],
    improvedEssay: result.improvedEssay || '',
    shortTeacherComment: result.shortTeacherComment || ''
  };

  const safeName = studentName || '未命名';
  let wordUrl: string | null = null;
  let pdfUrl: string | null = null;
  let docxSize = 0;

  try {
    const docxBuffer = await generateEssayReportDocx(reportInput);
    docxSize = docxBuffer.length;
    wordUrl = await saveFileToLocal(`essay_${safeName}_${taskId}`, docxBuffer, 'docx');
  } catch (err) {
    console.error('Failed to generate docx:', err);
  }

  // PDF 失败不阻塞 docx 成功(打印场景老师能拿到 Word 兜底)
  try {
    const pdfBuffer = await generateEssayReportPdf(reportInput);
    pdfUrl = await saveFileToLocal(`essay_${safeName}_${taskId}`, pdfBuffer, 'pdf');
    const task = await prisma.essayTask.findUnique({ where: { id: taskId }, select: { userId: true } });
    if (task) {
      await prisma.generatedFile.create({
        data: {
          userId: task.userId,
          sourceType: 'essay_report',
          sourceId: taskId,
          fileName: `${safeName}_作文批改报告.pdf`,
          fileType: 'pdf',
          fileUrl: pdfUrl,
          fileSize: pdfBuffer.length
        }
      });
    }
  } catch (err) {
    console.error('Failed to generate PDF:', err);
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
      wordUrl,
      pdfUrl
    }
  });

  if (wordUrl) {
    const task = await prisma.essayTask.findUnique({ where: { id: taskId }, select: { userId: true } });
    if (task) {
      await prisma.generatedFile.create({
        data: {
          userId: task.userId,
          sourceType: 'essay_report',
          sourceId: taskId,
          fileName: `${safeName}_作文批改报告.docx`,
          fileType: 'docx',
          fileUrl: wordUrl,
          fileSize: docxSize
        }
      });
    }
  }
}

// ============ 主入口 ============

export async function processEssayTask(taskId: string, reviewRequirement: string): Promise<void> {
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

    // 选 OCR 引擎(默认两步流水线,createMessage)
    const ocrEngine = USE_TWO_STEP ? ocrViaCreateMessage : ocrViaVlmEndpoint;
    console.log(`[essay:${taskId}] 使用 OCR 引擎: ${USE_TWO_STEP ? 'createMessage(两步)' : 'recognizeImage(一步)'}`);

    const ocrTexts = await downloadAndOcr(taskId, imageUrls, ocrEngine);
    const recognizedText = ocrTexts.join('\n\n');

    if (!recognizedText || recognizedText.length < 20) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: 'OCR 返回为空或太短,无法识别作文内容' }
      });
      await updateBatchCounts(task.batchId);
      return;
    }

    // 自动识别学生姓名(只看第一张图;只有原 studentName 为空时才覆盖)
    let effectiveStudentName: string | null = task.studentName;
    if (!effectiveStudentName) {
      const detected = extractStudentNameFromText(ocrTexts[0] || '');
      if (detected) {
        console.log(`[essay:${taskId}] 自动识别到学生姓名: ${detected}`);
        await prisma.essayTask.update({ where: { id: taskId }, data: { studentName: detected } });
        effectiveStudentName = detected;
      } else {
        console.log(`[essay:${taskId}] 未识别到学生姓名,保持空值`);
      }
    }

    // 批改
    const result = await gradeEssay(taskId, effectiveStudentName, reviewRequirement, recognizedText);
    if (!result.isReadable) {
      await prisma.essayTask.update({
        where: { id: taskId },
        data: { status: 'failed', errorMessage: result.errorMessage || '作文无法识别' }
      });
      await updateBatchCounts(task.batchId);
      return;
    }

    // 落库
    await persistReport(
      taskId,
      effectiveStudentName,
      task.batch.batchName,
      task.batch.reviewRequirement,
      recognizedText,
      result
    );
    await updateBatchCounts(task.batchId);
  } catch (err: any) {
    console.error(`[essay:${taskId}] 处理失败:`, err);
    cleanupTaskTempFiles(getTempDir(), taskId);
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
