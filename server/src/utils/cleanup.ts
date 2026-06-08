// 文件清理:防止 temp/ 和 uploads/ 长期累积学生作文图片 + 临时 OCR 图 + debug 文本
//
// 策略:
//   - temp/:  1 天前的所有文件直接删(OCR 临时图、ai_debug_*.txt、PDF 烟测产物)
//   - uploads/: 数据库里没引用 + 7 天前的孤儿文件删(避免误删近期上传)
//
// 调度:进程启动 30s 后跑首次,之后每 24h 跑一次。
// 没引入 node-cron,setInterval 已经够用。

import fs from 'fs';
import path from 'path';
import { getPrisma } from './db';

const TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000;          // 1 天
const UPLOAD_ORPHAN_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 天

export interface CleanupStats {
  tempDeleted: number;
  tempBytes: number;
  uploadsDeleted: number;
  uploadsBytes: number;
}

function fileNameFromUrlOrPath(s: string | null | undefined): string | null {
  if (!s) return null;
  // 兼容: 完整 URL / 相对路径 / 仅文件名
  const m = s.match(/(?:^|\/)uploads\/([^/?#]+)/);
  if (m) return m[1];
  // 兜底:取最后一段
  const seg = s.split(/[/\\]/).pop();
  return seg || null;
}

export async function runCleanup(opts: { tempDir: string; uploadsDir: string }): Promise<CleanupStats> {
  const stats: CleanupStats = { tempDeleted: 0, tempBytes: 0, uploadsDeleted: 0, uploadsBytes: 0 };

  // ============ 1. temp/ 清理 ============
  if (fs.existsSync(opts.tempDir)) {
    const cutoff = Date.now() - TEMP_MAX_AGE_MS;
    for (const name of fs.readdirSync(opts.tempDir)) {
      // 保留测试目录里 test-*.pdf 烟测产物的最近一份 (人手 review)
      const p = path.join(opts.tempDir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) {
          stats.tempBytes += st.size;
          fs.unlinkSync(p);
          stats.tempDeleted++;
        }
      } catch (_) { /* file 可能被并发删除,忽略 */ }
    }
  }

  // ============ 2. uploads/ 孤儿清理 ============
  if (fs.existsSync(opts.uploadsDir)) {
    const cutoff = Date.now() - UPLOAD_ORPHAN_MAX_AGE_MS;
    const referenced = await collectReferencedFiles();

    for (const name of fs.readdirSync(opts.uploadsDir)) {
      if (referenced.has(name)) continue;
      const p = path.join(opts.uploadsDir, name);
      try {
        const st = fs.statSync(p);
        if (st.isFile() && st.mtimeMs < cutoff) {
          stats.uploadsBytes += st.size;
          fs.unlinkSync(p);
          stats.uploadsDeleted++;
        }
      } catch (_) { /* ignore */ }
    }
  }

  return stats;
}

// 收集 DB 里所有被引用的 uploads 文件名,扫的表:
//   - generatedFile.fileUrl
//   - essayTask.imageUrls (JSON array) / wordUrl / pdfUrl
//   - lectureReview.wordUrl / pdfUrl
async function collectReferencedFiles(): Promise<Set<string>> {
  const referenced = new Set<string>();
  const prisma = getPrisma();

  const files = await prisma.generatedFile.findMany({ select: { fileUrl: true } });
  for (const f of files) {
    const n = fileNameFromUrlOrPath(f.fileUrl);
    if (n) referenced.add(n);
  }

  const tasks = await prisma.essayTask.findMany({
    select: { imageUrls: true, wordUrl: true, pdfUrl: true }
  });
  for (const t of tasks) {
    try {
      const urls = JSON.parse(t.imageUrls) as string[];
      for (const u of urls) {
        const n = fileNameFromUrlOrPath(u);
        if (n) referenced.add(n);
      }
    } catch (_) { /* imageUrls 异常时跳过 */ }
    const wn = fileNameFromUrlOrPath(t.wordUrl);
    if (wn) referenced.add(wn);
    const pn = fileNameFromUrlOrPath(t.pdfUrl);
    if (pn) referenced.add(pn);
  }

  const lectures = await prisma.lectureReview.findMany({
    select: { wordUrl: true, pdfUrl: true }
  });
  for (const l of lectures) {
    const wn = fileNameFromUrlOrPath(l.wordUrl);
    if (wn) referenced.add(wn);
    const pn = fileNameFromUrlOrPath(l.pdfUrl);
    if (pn) referenced.add(pn);
  }

  return referenced;
}

// 立即清理批改失败任务的临时图片(taskId 维度)
export function cleanupTaskTempFiles(tempDir: string, taskId: string): void {
  if (!fs.existsSync(tempDir)) return;
  const prefix = `essay_${taskId}_`;
  for (const name of fs.readdirSync(tempDir)) {
    if (!name.startsWith(prefix)) continue;
    try {
      fs.unlinkSync(path.join(tempDir, name));
    } catch (_) { /* ignore */ }
  }
}

let _scheduleHandle: NodeJS.Timeout | null = null;

export function startCleanupSchedule(opts: { tempDir: string; uploadsDir: string }) {
  // 防止重复启动(test 场景或热重启)
  if (_scheduleHandle) return;

  const tick = async () => {
    try {
      const stats = await runCleanup(opts);
      const tempMB = (stats.tempBytes / 1024 / 1024).toFixed(1);
      const upMB = (stats.uploadsBytes / 1024 / 1024).toFixed(1);
      console.log(
        `[cleanup] temp 删除 ${stats.tempDeleted} 个 / ${tempMB}MB; uploads 删除 ${stats.uploadsDeleted} 个 / ${upMB}MB`
      );
    } catch (err) {
      console.error('[cleanup] 失败:', err);
    }
  };

  // 启动 30s 后跑首次,之后每 24h 跑一次
  setTimeout(tick, 30_000);
  _scheduleHandle = setInterval(tick, 24 * 60 * 60 * 1000);
}

export function stopCleanupSchedule() {
  if (_scheduleHandle) {
    clearInterval(_scheduleHandle);
    _scheduleHandle = null;
  }
}
