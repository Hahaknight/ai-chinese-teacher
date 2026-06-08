// 素材搜索 safeJsonArray 测试
// 这是 2026-06 改动的 bug fix:tags 在 sqlite 里存的是 JSON 字符串,
// 老代码直接 includes() 字面量匹配,搜"坚持"误命中 "[\"坚持\"]" 字符串里的子串
// 跑法: cd server && npx vitest run src/routes/material.test.ts

import { describe, it, expect } from 'vitest';
import { safeJsonArray } from './material';

describe('safeJsonArray', () => {
  it('正常 JSON 数组', () => {
    expect(safeJsonArray('["a","b","c"]')).toEqual(['a', 'b', 'c']);
    expect(safeJsonArray('["坚持","信念","毅力"]')).toEqual(['坚持', '信念', '毅力']);
  });

  it('null / undefined / 空字符串 返回 []', () => {
    expect(safeJsonArray(null)).toEqual([]);
    expect(safeJsonArray(undefined)).toEqual([]);
    expect(safeJsonArray('')).toEqual([]);
  });

  it('非 JSON 字符串返回 []', () => {
    expect(safeJsonArray('坚持,信念,毅力')).toEqual([]);
    expect(safeJsonArray('not json at all')).toEqual([]);
  });

  it('JSON 对象(非数组)返回 []', () => {
    expect(safeJsonArray('{"a": 1}')).toEqual([]);
  });

  it('JSON 数字(非数组)返回 []', () => {
    expect(safeJsonArray('123')).toEqual([]);
  });
});

describe('搜索 tag 匹配逻辑(safeJsonArray + includes)', () => {
  // 模拟老代码 bug:m.tags 是 JSON 字符串 '["坚持","信念"]'
  // 老代码 m.tags.includes('坚持') 会因为字符串里有"坚持"字面量而误命中
  // 新代码 safeJsonArray(m.tags).includes('坚持') 才是数组成员严格匹配
  it('字符串字面量 includes 会误命中(老 bug 复现)', () => {
    const tagsRaw = '["毅力","奋斗"]';
    // 字符串包含子串 "毅" 但其实数组没有单字 "毅"
    expect(tagsRaw.includes('毅')).toBe(true);
    expect(safeJsonArray(tagsRaw).includes('毅')).toBe(false);
  });

  it('safeJsonArray.includes 严格匹配数组成员', () => {
    const tagsRaw = '["坚持","信念","毅力"]';
    expect(safeJsonArray(tagsRaw).includes('坚持')).toBe(true);
    expect(safeJsonArray(tagsRaw).includes('坚')).toBe(false);  // 单字不匹配
    expect(safeJsonArray(tagsRaw).includes('坚持不懈')).toBe(false);  // 超集不匹配
  });
});
