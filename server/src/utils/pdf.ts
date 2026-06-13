// PDF 生成:HTML 模板 → puppeteer (chromium) → PDF Buffer
// 设计原则:HTML 模板字段与 docx.ts 保持一致,老师看到的 Word 和 PDF 排版一致
// A4 / 黑白打印友好 / 思源宋体 fallback 系统默认
//
// 2026-06-14 改造:puppeteer v22+ 是 ESM-only,本项目 tsc 输出 CJS,顶层 `import puppeteer`
// 会被 require() 触发 ERR_REQUIRE_ESM。改用 dynamic import:运行时按需 import,避开
// CJS require ESM 的限制;之前能跑是因为 `npm run dev` 走 tsx(ESM 模式),现在走
// `pm2 start ecosystem.config.cjs`(node dist/app.js)必须用 dynamic import。

import type { Browser, Page } from 'puppeteer';
import type { EssayReportData, LectureReviewData } from './docx';

// 缓存 dynamic import 结果(整个模块的 namespace)
let _puppeteer: typeof import('puppeteer') | null = null;
async function loadPuppeteer(): Promise<typeof import('puppeteer')> {
  if (_puppeteer) return _puppeteer;
  _puppeteer = await import('puppeteer');
  return _puppeteer;
}

const A4_MARGIN = '20mm';

// 通用 HTML 外壳:CSS reset + A4 + 打印样式
function wrapHtml(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<title>${escapeHtml(title)}</title>
<style>
  @page { size: A4; margin: ${A4_MARGIN}; }
  * { box-sizing: border-box; }
  body {
    font-family: "Source Han Serif SC", "Noto Serif CJK SC", "Songti SC", "SimSun", "宋体", serif;
    color: #000;
    font-size: 12pt;
    line-height: 1.6;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  h1 { font-size: 22pt; text-align: center; margin: 0 0 20pt; }
  h2 { font-size: 16pt; margin: 20pt 0 8pt; border-bottom: 1pt solid #333; padding-bottom: 4pt; }
  h3 { font-size: 13pt; margin: 14pt 0 6pt; }
  p { margin: 4pt 0; text-align: justify; }
  ul { margin: 4pt 0; padding-left: 20pt; }
  li { margin: 2pt 0; }
  table { width: 100%; border-collapse: collapse; margin: 8pt 0; }
  th, td { border: 1pt solid #333; padding: 6pt 8pt; vertical-align: top; }
  th { background-color: #f0f0f0; font-weight: 600; }
  .meta { margin: 4pt 0; }
  .meta-label { display: inline-block; min-width: 80pt; color: #666; }
  .recognized-text, .improved-essay, .comment {
    white-space: pre-wrap;
    background: #fafafa;
    padding: 8pt 10pt;
    border-left: 3pt solid #999;
    margin: 4pt 0;
  }
  .short-comment {
    background: #f0f5ff;
    padding: 10pt 14pt;
    border-radius: 6pt;
    font-weight: 600;
    margin: 6pt 0;
  }
  .highlight::before { content: "✓ "; color: #2e7d32; font-weight: bold; }
  .problem::before { content: "✗ "; color: #c62828; font-weight: bold; }
  .suggestion { display: flex; gap: 6pt; }
  .suggestion::before { content: attr(data-idx) "."; color: #0082FF; font-weight: 600; min-width: 16pt; }
  .practice-block, .problem-block {
    background: #f8f9fa;
    padding: 8pt 10pt;
    border-radius: 4pt;
    margin: 6pt 0;
  }
  .practice-block .answer { background: #e8f5e9; padding: 6pt 8pt; border-radius: 3pt; margin-top: 4pt; }
  .expression-block { background: #f0f5ff; padding: 6pt 8pt; border-radius: 3pt; margin: 4pt 0; }
</style>
</head>
<body>
${body}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function scoreItemsTable(score: EssayReportData['score']): string {
  const rows = (score.items || []).map(i => `
    <tr>
      <td>${escapeHtml(i.name)}</td>
      <td>${escapeHtml(String(i.score))}</td>
      <td>${escapeHtml(String(i.fullScore))}</td>
      <td>${escapeHtml(i.comment)}</td>
    </tr>`).join('');
  return `
    <table>
      <thead>
        <tr><th>评分项</th><th>得分</th><th>满分</th><th>评价</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

export function renderEssayReportHtml(d: EssayReportData): string {
  const body = `
    <h1>作文批改报告</h1>

    <h2>一、基础信息</h2>
    <p class="meta"><span class="meta-label">学生姓名：</span>${escapeHtml(d.studentName || '未命名')}</p>
    <p class="meta"><span class="meta-label">批次名称：</span>${escapeHtml(d.batchName)}</p>
    <p class="meta"><span class="meta-label">批改要求：</span>${escapeHtml(d.reviewRequirement)}</p>

    <h2>二、识别出的作文原文</h2>
    <div class="recognized-text">${escapeHtml(d.recognizedText || '（未识别到作文内容）')}</div>

    <h2>三、作文评分</h2>
    <p class="meta"><span class="meta-label">总分：</span><strong>${d.score.total} / ${d.score.fullScore}</strong></p>
    ${scoreItemsTable(d.score)}

    <h2>四、作文总评</h2>
    <p>${escapeHtml(d.overallComment)}</p>

    <h2>五、作文亮点</h2>
    <ul>${(d.highlights || []).map(h => `<li class="highlight">${escapeHtml(h)}</li>`).join('')}</ul>

    <h2>六、主要问题</h2>
    <ul>${(d.problems || []).map(p => `<li class="problem">${escapeHtml(p)}</li>`).join('')}</ul>

    <h2>七、修改建议</h2>
    <ul>${(d.suggestions || []).map((s, i) => `<li class="suggestion" data-idx="${i + 1}">${escapeHtml(s)}</li>`).join('')}</ul>

    <h2>八、改良后的作文</h2>
    <div class="improved-essay">${escapeHtml(d.improvedEssay)}</div>

    <h2>九、教师简短评语</h2>
    <div class="short-comment">${escapeHtml(d.shortTeacherComment)}</div>
  `;
  return wrapHtml(`作文批改报告 - ${d.studentName}`, body);
}

export function renderLectureReviewHtml(d: LectureReviewData, batchName: string): string {
  const typicalHtml = (d.typicalProblemExplanation || []).map(t => `
    <div class="problem-block">
      <p><strong>问题：</strong>${escapeHtml(t.problem)}</p>
      <p><strong>原因：</strong>${escapeHtml(t.reason)}</p>
      <p><strong>方法：</strong>${escapeHtml(t.method)}</p>
    </div>`).join('');

  const practiceHtml = (d.classPractice || []).map(p => `
    <div class="practice-block">
      <p><strong>【练习】</strong>${escapeHtml(p.exercise)}</p>
      <p><strong>【引导】</strong>${escapeHtml(p.guide)}</p>
      <div class="answer"><strong>【参考答案】</strong>${escapeHtml(p.answer)}</div>
    </div>`).join('');

  const body = `
    <h1>作文讲评课方案</h1>
    <h2 style="text-align:center;border:none;">《${escapeHtml(batchName)}》</h2>

    <h2>一、本次作文整体情况</h2>
    <p>${escapeHtml(d.overallSituation)}</p>

    <h2>二、本次作文主要优点</h2>
    <ul>${(d.mainStrengths || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>

    <h2>三、本次作文共性问题</h2>
    <ul>${(d.commonProblems || []).map(p => `<li>${escapeHtml(p)}</li>`).join('')}</ul>

    <h2>四、典型问题讲解</h2>
    ${typicalHtml}

    <h2>五、优秀表达赏析</h2>
    ${(d.excellentExpressions || []).map(e => `<div class="expression-block"><strong>【示例】</strong>${escapeHtml(e)}</div>`).join('')}

    <h2>六、课堂修改练习</h2>
    ${practiceHtml}

    <h2>七、课后提升建议</h2>
    <ul>${(d.afterClassSuggestions || []).map(s => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
  `;
  return wrapHtml(d.title || '作文讲评课方案', body);
}

// 启动一个 puppeteer browser,整个进程复用(启动 chromium 约 1-2s,不能每次 PDF 都重启)
// 单例 + lazy init,失败时回退到重建
// 用 dynamic import 拿 puppeteer,避免 CJS require ESM 报错
let _browserPromise: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (_browserPromise) return _browserPromise;
  const puppeteer = await loadPuppeteer();
  _browserPromise = puppeteer.default.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',  // docker / WSL 下共享内存不够时
      '--font-render-hinting=none'  // 中文字体 hinting 关闭,避免字形错位
    ]
  }).catch((err) => {
    // 失败时清空 promise,下次调用重试
    _browserPromise = null;
    throw err;
  });
  return _browserPromise;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  let page: Page | null = null;
  try {
    page = await browser.newPage();
    // HTML 是自含的(无外部资源),用 domcontentloaded 即可
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '20mm', right: '20mm' }
    });
    return Buffer.from(pdf);
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

export async function generateEssayReportPdf(d: EssayReportData): Promise<Buffer> {
  return htmlToPdf(renderEssayReportHtml(d));
}

export async function generateLectureReviewPdf(d: LectureReviewData, batchName: string): Promise<Buffer> {
  return htmlToPdf(renderLectureReviewHtml(d, batchName));
}

// 进程退出时关闭 browser,避免 chromium 孤儿进程
export async function closeBrowser(): Promise<void> {
  if (_browserPromise) {
    const b = await _browserPromise;
    await b.close().catch(() => {});
    _browserPromise = null;
  }
}
