// 集中管理 baseUrl、状态文案、分类等常量
// 真机调试时请把下面的 host 改成你电脑在局域网中的 IP(如 http://192.168.1.100:3000/api)

function getBaseUrl() {
  try {
    const app = getApp();
    if (app && app.globalData && app.globalData.baseUrl) {
      return app.globalData.baseUrl;
    }
  } catch (e) {
    // getApp() 在 App() 之外调用会抛错,这里兜底
  }
  return 'http://127.0.0.1:3000/api';
}

module.exports = {
  BASE_URL: getBaseUrl(),

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
