Page({
  data: {
    sentence: '',
    result: null,
    loading: false
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

    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/sentence-fix`,
      method: 'POST',
      header: { Authorization: `Bearer ${token}` },
      data: { sentence },
      success: res => {
        this.setData({ loading: false });
        if (res.data.code === 0) {
          this.setData({ result: res.data.data });
        } else {
          wx.showToast({ title: res.data.message || '处理失败', icon: 'none' });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
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