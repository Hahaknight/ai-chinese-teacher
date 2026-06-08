// 集中管理 baseUrl、状态文案、分类等常量
// 真机调试时不要直接改本文件,请创建 config.local.js(本目录)覆盖 BASE_URL
// 详见 config.local.js.example

const path = './config.local.js';

function readLocalOverride() {
  try {
    return require(path) || {};
  } catch (e) {
    return {};
  }
}

const localOverride = readLocalOverride();

const BASE_URL = localOverride.BASE_URL || 'http://127.0.0.1:3000/api';

module.exports = {
  BASE_URL,

  // 当前是否在真机(非 127.0.0.1 / localhost)环境
  // 用于决定是否在首页展示"真机扫码"提示横幅
  IS_REMOTE_HOST: !/^http:\/\/(127\.0\.0\.1|localhost):/.test(BASE_URL),

  // 批改状态文案
  BATCH_STATUS: {
    pending: '待批改',
    processing: '批改中',
    completed: '已完成',
    partial: '部分完成',
    failed: '失败'
  },

  // 单个学生任务状态文案
  TASK_STATUS: {
    pending: '待批改',
    processing: '批改中',
    success: '成功',
    failed: '失败'
  },

  // 素材分类(8 类,和 prisma schema 一致)
  MATERIAL_CATEGORIES: ['成长', '坚持', '亲情', '挫折', '自信', '时间', '理想', '观察生活'],

  // 文件类型图标
  FILE_ICONS: {
    docx: '📄',
    pdf: '📑',
    zip: '🗜️'
  },

  // 默认评分项(50 分制)
  DEFAULT_SCORE_ITEMS: [
    { name: '立意中心', fullScore: 10 },
    { name: '内容材料', fullScore: 15 },
    { name: '结构层次', fullScore: 10 },
    { name: '语言表达', fullScore: 10 },
    { name: '卷面规范', fullScore: 5 }
  ]
};
