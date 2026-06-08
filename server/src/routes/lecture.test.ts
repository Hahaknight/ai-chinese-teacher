// 讲评课 AI 返回校验测试
// 历史 bug:AI 偶尔返回数组 [...] 而不是对象 {...},导致前端 detail 页全空
// 跑法: cd server && npx vitest run src/routes/lecture.test.ts

import { describe, it, expect } from 'vitest';
import { parseLectureData } from './lecture';

describe('parseLectureData', () => {
  it('合法 8 字段对象 → 原样返回', () => {
    const aiText = JSON.stringify({
      title: '《那一刻,我长大了》讲评课',
      overallSituation: '整体良好',
      mainStrengths: ['主题鲜明'],
      commonProblems: ['过渡生硬'],
      typicalProblemExplanation: [{ problem: '过渡生硬', reason: '缺连词', method: '加过渡' }],
      excellentExpressions: ['优秀句子'],
      classPractice: [{ exercise: '题', guide: '引导', answer: '答案' }],
      afterClassSuggestions: ['多读']
    });
    const r = parseLectureData(aiText);
    expect(r).not.toBeNull();
    expect(r.title).toBe('《那一刻,我长大了》讲评课');
    expect(r.mainStrengths).toEqual(['主题鲜明']);
  });

  it('AI 误返回数组 [...] → null(必须被拦截)', () => {
    const aiText = JSON.stringify(['整体不错', '主题鲜明', '细节充分']);
    expect(parseLectureData(aiText)).toBeNull();
  });

  it('AI 返回纯字符串/数字 → null', () => {
    expect(parseLectureData(JSON.stringify('just a string'))).toBeNull();
    expect(parseLectureData(JSON.stringify(42))).toBeNull();
  });

  it('AI 返回非法 JSON → null', () => {
    expect(parseLectureData('not json at all')).toBeNull();
    expect(parseLectureData('')).toBeNull();
  });

  it('部分字段缺失 → 补默认空数组/空字符串', () => {
    const aiText = JSON.stringify({ title: 'X' });  // 只有 title
    const r = parseLectureData(aiText);
    expect(r).not.toBeNull();
    expect(r.title).toBe('X');
    expect(r.overallSituation).toBe('');
    expect(r.mainStrengths).toEqual([]);
    expect(r.commonProblems).toEqual([]);
    expect(r.typicalProblemExplanation).toEqual([]);
    expect(r.excellentExpressions).toEqual([]);
    expect(r.classPractice).toEqual([]);
    expect(r.afterClassSuggestions).toEqual([]);
  });

  it('字段类型不对(数组应为字符串) → 兜底补空数组', () => {
    const aiText = JSON.stringify({
      title: 'X',
      mainStrengths: 'not an array',  // 应该是 string[]
      overallSituation: 123             // 应该是 string
    });
    const r = parseLectureData(aiText);
    expect(r).not.toBeNull();
    expect(r.mainStrengths).toEqual([]);
    expect(r.overallSituation).toBe('');
  });

  it('包裹在 ```json 围栏里 → 提取后正常解析', () => {
    const aiText = '```json\n{"title":"X","mainStrengths":["a","b"]}\n```';
    const r = parseLectureData(aiText);
    expect(r).not.toBeNull();
    expect(r.title).toBe('X');
    expect(r.mainStrengths).toEqual(['a', 'b']);
  });
});
