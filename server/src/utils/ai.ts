// minimax 客户端(OpenAI 兼容格式)
// 默认 endpoint: https://api.minimaxi.com/v1
// 默认模型: MiniMax-M3(支持图片/视频输入,原生多模态)
// Fallback: MiniMax-M2.7
//
// 注意:minimax 国内 OpenAI 兼容接口不支持 role: 'developer' 角色,使用 system / user / assistant

import axios from 'axios';

const API_KEY = process.env.MINIMAX_API_KEY || process.env.ANTHROPIC_API_KEY || '';
const BASE_URL = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com/v1').replace(/\/$/, '');
const MODEL = process.env.MINIMAX_MODEL || 'MiniMax-M3';
const FALLBACK_MODEL = process.env.MINIMAX_FALLBACK_MODEL || 'MiniMax-M2.7';
export { FALLBACK_MODEL };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const DEFAULT_RETRY_INTERVAL_MS = 30000;

export interface ContentText {
  type: 'text';
  text: string;
}

export interface ContentImage {
  type: 'image_url';
  image_url: {
    url: string;
  };
}

export type ContentItem = ContentText | ContentImage;
export type Role = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: Role;
  content: string | ContentItem[];
}

export interface CreateMessageOptions {
  system?: string;
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  model?: string;
  timeoutMs?: number;
  // JSON mode 控制:
  //   'json_object' = 强制开启 response_format: { type: 'json_object' }
  //   'none'        = 强制关闭(OCR 之类返回纯文本的场景用)
  //   undefined     = 沿用环境变量 JSON_MODE(默认开)
  responseFormat?: 'json_object' | 'none';
  // 验证函数:返回 false 则触发重试(用于 M3 偶尔"忘记"按 JSON 格式输出的情况)
  validate?: (text: string) => boolean;
  // 网络/超时/AiError 失败时的最大重试次数(默认 5)
  retries?: number;
  // 重试间隔(ms),默认 30000
  retryIntervalMs?: number;
}

export class AiError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'AiError';
    this.statusCode = statusCode;
  }
}

async function callModel(
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  temperature: number,
  timeoutMs: number,
  responseFormat: 'json_object' | 'none' | undefined
): Promise<string> {
  // JSON mode 选择优先级:显式参数 > 环境变量
  let useJsonMode: boolean;
  if (responseFormat === 'json_object') useJsonMode = true;
  else if (responseFormat === 'none') useJsonMode = false;
  else useJsonMode = process.env.JSON_MODE !== '0';

  const body: any = { model, messages, max_tokens: maxTokens, temperature };
  if (useJsonMode) body.response_format = { type: 'json_object' };

  try {
    const resp = await axios.post(
      `${BASE_URL}/chat/completions`,
      body,
      {
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        timeout: timeoutMs
      }
    );

    const content = resp.data?.choices?.[0]?.message?.content;
    if (content == null) {
      throw new AiError(`Empty response from ${model}`);
    }
    return content;
  } catch (err: any) {
    const status = err.response?.status;
    const msg = err.response?.data?.error?.message || err.response?.data?.message || err.message;
    throw new AiError(`Model ${model} failed: ${msg}`, status);
  }
}

// 检测 messages 里是否含有 image_url 内容(用于强制图像任务走 M2.7)
// M3 在 OCR 场景会幻觉补充看不清的字(2026-06-03 实测),所有图像任务必须用 M2.7
function hasImageContent(messages: ChatMessage[]): boolean {
  for (const m of messages) {
    if (typeof m.content === 'string') continue;
    if (Array.isArray(m.content) && m.content.some(c => c.type === 'image_url')) return true;
  }
  return false;
}

// 发送消息,失败时按顺序 fallback:主模型 → fallback 模型
export async function createMessage(opts: CreateMessageOptions): Promise<string> {
  if (!API_KEY) {
    throw new AiError('MINIMAX_API_KEY is not configured');
  }

  const maxTokens = opts.maxTokens || 4096;
  const temperature = opts.temperature ?? 0.7;
  const timeoutMs = opts.timeoutMs || 180000;
  const responseFormat = opts.responseFormat;
  const validate = opts.validate;
  const maxRetries = Math.max(0, opts.retries ?? 5);
  const retryIntervalMs = opts.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS;

  const messages: ChatMessage[] = opts.system
    ? [{ role: 'system', content: opts.system }, ...opts.messages]
    : opts.messages;

  // 含图像的请求强制走 M2.7,不允许用 M3(幻觉问题)
  // 即便外部传 opts.model='MiniMax-M3' 也会被覆盖,fallback 也只用 M2.7
  const isImageRequest = hasImageContent(messages);
  let primary: string;
  let candidates: string[];
  if (isImageRequest) {
    primary = FALLBACK_MODEL;  // FALLBACK_MODEL 默认是 M2.7
    candidates = [primary];     // 图像任务不再 fallback,M2.7 本身就是最低档
    if (opts.model && opts.model !== FALLBACK_MODEL) {
      console.warn(`[ai] 图像任务忽略 opts.model=${opts.model},强制使用 ${primary}(M3 OCR 幻觉)`);
    }
  } else {
    primary = opts.model || MODEL;
    candidates = primary === FALLBACK_MODEL ? [primary] : [primary, FALLBACK_MODEL];
  }

  let lastError: Error | null = null;
  for (const modelName of candidates) {
    // 每次 model 重试(validate 失败时)用同一个 model,不再 fallback 到下一个 model
    // 避免在重试时跳到 fallback 模型浪费配额
    let attempt = 0;
    while (attempt <= maxRetries) {
      try {
        const text = await callModel(modelName, messages, maxTokens, temperature, timeoutMs, responseFormat);
        if (validate && !validate(text)) {
          attempt += 1;
          if (attempt <= maxRetries) {
            console.warn(`[ai] model ${modelName} validate 失败,重试 ${attempt}/${maxRetries},${retryIntervalMs / 1000}s 后`);
            await sleep(retryIntervalMs);
            continue;
          }
          // 重试用尽,fall through 到下一个 model
          throw new AiError(`Model ${modelName} returned invalid response after ${maxRetries} retries`);
        }
        return text;
      } catch (err: any) {
        if (err instanceof AiError && err.message.includes('retries')) {
          // validate 重试用尽,跳出 while 继续下一个 model
          lastError = err;
          break;
        }
        attempt += 1;
        if (attempt <= maxRetries) {
          console.warn(`[ai] model ${modelName} 失败(尝试 ${attempt}/${maxRetries + 1}),${retryIntervalMs / 1000}s 后重试: ${err.message}`);
          await sleep(retryIntervalMs);
          continue; // 重试同 model(不立即跳到 fallback,避免浪费主模型配额)
        }
        console.error(`[ai] model ${modelName} 重试 ${maxRetries} 次后仍失败:`, err.message);
        lastError = err;
        break; // 重试用尽,跳到下一个 model
      }
    }
    if (modelName === FALLBACK_MODEL) break;
  }

  throw lastError || new AiError('All models failed');
}

// 把本地图片文件转成 multimodal content(传 base64 data URL)
export function imageFileToContent(filePath: string, mimeType: string = 'image/jpeg'): ContentImage {
  const fs = require('fs') as typeof import('fs');
  const buffer = fs.readFileSync(filePath);
  const base64 = buffer.toString('base64');
  return {
    type: 'image_url',
    image_url: { url: `data:${mimeType};base64,${base64}` }
  };
}

// 工具:从 AI 输出中提取 JSON(只做容错处理 code block / 前后缀 / 思考链)
// 严格 JSON.parse,不做任何"修复内部引号"之类的启发式 —
// 那些修复对 CJK 文本里的边界判断不可靠,会把真边界转成内部,导致结果残缺。
// AI 输出畸形时直接报错并写 debug 文件,让用户重试或调整 prompt。

export function extractJson<T = any>(text: string): T {
  if (text == null) {
    throw new Error('AI 返回为空');
  }

  // 预处理:剥掉 minimax M3 的 <think>...</think> 推理块(可能出现在文本头部或夹杂在 JSON 中)
  let cleaned = String(text);
  cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // 也兼容 <think> 未闭合(尾部省略号情况)
  cleaned = cleaned.replace(/<think>[\s\S]*$/gi, '').trim();

  const tryParse = (s: string): T | null => {
    const t = s.trim();
    if (!t) return null;
    return JSON.parse(t) as T;
  };

  // 1. 直接 parse(整段)
  try {
    const direct = tryParse(cleaned);
    if (direct) return direct;
  } catch (_) { /* fall through */ }

  // 2. ```json ... ``` / ``` ... ``` 围栏
  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/i;
  const fenceMatch = cleaned.match(fenceRe);
  if (fenceMatch) {
    try {
      const fenced = tryParse(fenceMatch[1]);
      if (fenced) return fenced;
    } catch (_) { /* fall through */ }
  }

  // 3. 第一个 { ... } 块(非贪婪到第一个合法闭合)
  const objMatch = cleaned.match(/\{[\s\S]*?\}/);
  if (objMatch) {
    try {
      const obj = tryParse(objMatch[0]);
      if (obj) return obj;
    } catch (_) { /* fall through */ }
  }

  // 4. 第一个 [ ... ] 块
  const arrMatch = cleaned.match(/\[[\s\S]*?\]/);
  if (arrMatch) {
    try {
      const arr = tryParse(arrMatch[0]);
      if (arr) return arr;
    } catch (_) { /* fall through */ }
  }

  // 全部失败:把原文写盘 + 控制台打前 800 字符,方便排查
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  const debugPath = path.join(process.cwd(), 'temp', `ai_debug_${Date.now()}.txt`);
  try {
    fs.mkdirSync(path.dirname(debugPath), { recursive: true });
    fs.writeFileSync(debugPath, String(text), 'utf8');
  } catch (_) { /* ignore */ }

  const preview = String(text).slice(0, 800);
  console.error(`[extractJson] 无法解析 AI 返回 (长度 ${String(text).length} 字符),已写到 ${debugPath}`);
  console.error(`[extractJson] 原文前 800 字符: ${preview}`);

  throw new Error(`Failed to extract JSON from AI response. Raw preview: ${preview.slice(0, 200)}...`);
}
