// 作文批改流水线核心解析函数测试
// 这些函数是最容易回归的:OCR 文本解析、姓名识别策略、JSON 容错
// 跑法: cd server && npx vitest run src/services/essay.service.test.ts

import { describe, it, expect } from 'vitest';
import {
  extractStudentNameFromText,
  extractNameCandidates
} from './essay.service';
import { extractJson } from '../utils/ai';

describe('extractStudentNameFromText', () => {
  it('策略 1: 标准"姓名:XXX"标签', () => {
    expect(extractStudentNameFromText('姓名:张三\n班级:五(1)班')).toBe('张三');
    expect(extractStudentNameFromText('姓名：李小明\n')).toBe('李小明');
    expect(extractStudentNameFromText('学生姓名:王红梅')).toBe('王红梅');
  });

  it('策略 2: 第一行 2-4 字中文', () => {
    expect(extractStudentNameFromText('赵磊\n那一刻,我长大了\n本文是...')).toBe('赵磊');
    expect(extractStudentNameFromText('陈志强 五年级\n作文标题')).toBe('陈志强');
  });

  it('策略 3: 作文里"我叫XXX"自报', () => {
    const text = '语文 答题卡\n\n那一刻,我长大了\n大家好,我叫刘晓燕,今年十二岁...';
    expect(extractStudentNameFromText(text)).toBe('刘晓燕');
  });

  it('排除常见模板词不当姓名', () => {
    expect(extractStudentNameFromText('语文 答题卡\n')).toBe('');
    expect(extractStudentNameFromText('姓名:答题卡\n')).toBe('');
    expect(extractStudentNameFromText('作文 五年级\n')).toBe('');
    expect(extractStudentNameFromText('那一刻,我长大了\n')).toBe('');
  });

  it('空字符串/无姓名返回空', () => {
    expect(extractStudentNameFromText('')).toBe('');
    expect(extractStudentNameFromText('123 ABC')).toBe('');
  });
});

describe('extractNameCandidates', () => {
  it('从作文头部 OCR 文本中找出候选姓名', () => {
    const text = '语文 答题卡\n张三 五(1)班 学号 28\n那一刻,我长大了\n本文张三同学描述...';
    const candidates = extractNameCandidates(text, 5);
    expect(candidates).toContain('张三');
  });

  it('按出现次数排序', () => {
    const text = '王明 王明 王明 李华 张三';
    const candidates = extractNameCandidates(text, 5);
    expect(candidates[0]).toBe('王明');
  });

  it('过滤模板词', () => {
    const text = '语文 答题卡 答题 作文 那一刻 张三';
    const candidates = extractNameCandidates(text, 5);
    expect(candidates).not.toContain('语文');
    expect(candidates).not.toContain('答题');
    expect(candidates).not.toContain('作文');
    expect(candidates).not.toContain('那一刻');
    expect(candidates).toContain('张三');
  });

  it('限制候选数量', () => {
    const text = '张三 李四 王五 赵六 钱七 孙八 周九';
    const candidates = extractNameCandidates(text, 3);
    expect(candidates.length).toBeLessThanOrEqual(3);
  });
});

describe('extractJson - AI 返回 JSON 解析容错', () => {
  it('直接 parse 干净 JSON', () => {
    const text = '{"score": 90, "name": "张三"}';
    expect(extractJson(text)).toEqual({ score: 90, name: '张三' });
  });

  it('剥掉 ```json 围栏', () => {
    const text = '这里是说明\n```json\n{"a": 1}\n```\n更多文字';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('剥掉 <think> 推理块', () => {
    const text = '<think>让我想想...</think>\n{"result": "ok"}';
    expect(extractJson(text)).toEqual({ result: 'ok' });
  });

  it('剥掉未闭合的 <think>', () => {
    const text = '<think>分析中...更多分析\n{"result": "ok"}';
    // 未闭合的 think 会吞掉 JSON,函数应该 throw(因为后面没合法 JSON)
    // 这里测的是:剥掉到尾部模式 - 实际行为是吃掉了全部,所以 throw
    expect(() => extractJson(text)).toThrow();
  });

  it('提取嵌入在文字里的第一个 {}', () => {
    const text = '说明文字 {"a": 1} 后续文字';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it('返回为空抛错', () => {
    expect(() => extractJson('')).toThrow();
    expect(() => extractJson(null as any)).toThrow();
  });

  it('完全无法解析时抛错', () => {
    expect(() => extractJson('这就是一段纯文本,没有 JSON')).toThrow();
  });

  it('JSON 数组也能被解析', () => {
    const text = '[1, 2, 3]';
    expect(extractJson(text)).toEqual([1, 2, 3]);
  });

  it('CJK 字符不破坏边界', () => {
    const text = '{"comment": "这是一个很好的作文,体现了\\"主题\\""}';
    expect(extractJson(text)).toEqual({ comment: '这是一个很好的作文,体现了"主题"' });
  });
});
