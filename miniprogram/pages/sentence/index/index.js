const { request } = require('../../../utils/request');

Page({
  data: {
    sentence: '',
    result: null,
    loading: false,
    recordId: ''
  },

  onLoad(options) {
    if (options && options.recordId) {
      this.setData({ recordId: options.recordId });
      this.loadRecord(options.recordId);
    }
  },

  loadRecord(recordId) {
    request({ url: `/sentence-fix/records/${recordId}`, hideLoading: true })
      .then(res => {
        const r = res.data || {};
        this.setData({
          sentence: r.originalSentence || '',
          result: {
            originalSentence: r.originalSentence,
            problemAnalysis: r.problemAnalysis,
            fixedSentence: r.fixedSentence,
            explanation: r.explanation,
            similarExample: r.similarExample
          }
        });
      })
      .catch(() => {
        wx.showToast({ title: '记录加载失败', icon: 'none' });
      });
  },

  onSentenceInput(e) {
    this.setData({ sentence: e.detail.value });
  },

  fixSentence() {
    const { sentence } = this.data;

    if (!sentence) {
      wx.showToast({ title: '请输入句子', icon: 'none' });
      return;
    }

    this.setData({ loading: true });
    request({
      url: '/sentence-fix',
      method: 'POST',
      data: { sentence }
    })
      .then(res => {
        this.setData({ result: res.data, loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
      });
  },

  copyResult() {
    const { result } = this.data;
    if (!result) return;

    const text = `原句：${result.originalSentence}
问题分析：${result.problemAnalysis}
修改版本：${result.fixedSentence}
讲解说明：${result.explanation}
同类示例：${result.similarExample}`;

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  }
});