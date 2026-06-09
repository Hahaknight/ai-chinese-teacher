// 图片识别服务(2026-06 改版,直连 minimax VLM 端点)
//
// 调用链路:本服务 POST https://api.minimaxi.com/v1/coding_plan/vlm
//           显式传 model=MiniMax-M2.7(M3 在 OCR 场景会幻觉补充文字,2026-06-03 实测)
//
// 历史:B 阶段之前走 MCP 子进程 (uvx minimax-coding-plan-mcp) 调 understand_image,
//      有两个问题:
//        1. 工具签名只有 prompt/image_source,没有 model 参数,无法强制 M2.7
//        2. 协议握手格式不匹配,框架返回 "Invalid request parameters"
//      改直连后两个问题都解决,且无子进程开销。
//
// 配套:app.ts 顶部 import 'dotenv/config' 让 MINIMAX_API_KEY 在 process.env 可用
//       (tsx watch 不自动加载 .env)

import fs from 'fs';
import path from 'path';
import axios from 'axios';

const API_KEY = process.env.MINIMAX_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const VLM_URL =
  (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1') + '/coding_plan/vlm';
const OCR_MODEL = 'MiniMax-M2.7';

const DEFAULT_TIMEOUT_MS = 120000;        // 单次超时 2 分钟
const DEFAULT_RETRIES = 3;                  // 失败重试 3 次
const DEFAULT_RETRY_INTERVAL_MS = 10000;   // 重试间隔 10 秒

export interface RecognizeOptions {
  prompt?: string;
  retries?: number;
  retryIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_PROMPT =
  '请按以下顺序仔细识别图片中的文字:\n' +
  '1. 【优先级最高】图片顶部的姓名/班级/学号信息(通常位于"语文 答题卡"等字样附近,可能是手写,字迹可能模糊,务必仔细辨认,常见姓名 2-4 个汉字)\n' +
  '2. 作文标题\n' +
  '3. 作文正文\n\n' +
  '要求:\n' +
  '- 按原文一字不改地输出,保留段落、标点和换行\n' +
  '- 看不清的字用 [?] 标记,不要猜测\n' +
  '- 只输出识别到的文字,不要输出思考过程、解释或 Markdown 标记';

function detectImageFormat(imagePath: string): 'jpeg' | 'png' | 'webp' {
  const lower = imagePath.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.webp')) return 'webp';
  return 'jpeg';
}

export async function recognizeImage(
  imagePath: string,
  options: RecognizeOptions = {}
): Promise<string> {
  if (!API_KEY) {
    throw new Error('MINIMAX_API_KEY not configured (check .env)');
  }
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Image file not found: ${imagePath}`);
  }

  const prompt = options.prompt ?? DEFAULT_PROMPT;
  const maxRetries = Math.max(1, options.retries ?? DEFAULT_RETRIES);
  const retryIntervalMs = options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // 一次性读图 + base64(7MB 图 → ~10MB 字符串,axios body limit 需要放宽)
  const imageBuffer = fs.readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const format = detectImageFormat(imagePath);
  const imageUrl = `data:image/${format};base64,${base64}`;
  const payloadSizeMB = (Buffer.byteLength(imageUrl) / 1024 / 1024).toFixed(2);
  console.log(`[VLM] ${imagePath} size=${imageBuffer.length}B base64=${payloadSizeMB}MB model=${OCR_MODEL}`);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const t0 = Date.now();
    try {
      const response = await axios.post(
        VLM_URL,
        { model: OCR_MODEL, prompt, image_url: imageUrl },
        {
          headers: {
            Authorization: `Bearer ${API_KEY}`,
            'MM-API-Source': 'Minimax-Direct',
            'Content-Type': 'application/json'
          },
          timeout: timeoutMs,
          maxBodyLength: 50 * 1024 * 1024,
          maxContentLength: 50 * 1024 * 1024
        }
      );

      const data = response.data || {};
      const baseResp = data.base_resp || {};
      if (baseResp.status_code !== 0) {
        throw new Error(
          `VLM API error: ${baseResp.status_code}-${baseResp.status_msg || 'unknown'}`
        );
      }
      const content = (data.content || '').trim();
      if (!content) {
        throw new Error('VLM API returned empty content');
      }
      console.log(
        `[VLM] OCR success attempt=${attempt} elapsed=${Date.now() - t0}ms length=${content.length}`
      );
      return content;
    } catch (err: any) {
      const status = err?.response?.status;
      const apiMsg = err?.response?.data?.base_resp?.status_msg;
      const detail = apiMsg || err?.message || String(err);
      console.error(`[VLM] attempt ${attempt}/${maxRetries} failed (${status || 'no-status'}): ${detail}`);

      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, retryIntervalMs));
        continue;
      }
      throw new Error(`Image recognition failed after ${maxRetries} attempts: ${detail}`);
    }
  }

  throw new Error('Image recognition failed (unreachable)');
}

export async function downloadImage(url: string, localPath: string): Promise<void> {
  // 2026-06-09: 提取 /uploads/xxx 相对路径(无论 URL 是绝对还是相对),
  // 命中本地文件直接读,避免走 https 自签证书下载。失败则降级走 HTTP。
  const m = url.match(/(\/uploads\/[^?#]+)/);
  if (m) {
    const rel = m[1].replace(/^\//, '');
    const localFile = path.join(process.cwd(), rel);
    if (fs.existsSync(localFile)) {
      fs.copyFileSync(localFile, localPath);
      return;
    }
  }
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  fs.writeFileSync(localPath, response.data);
}

export function cleanup() {
  // 无子进程,无资源需要释放
}
