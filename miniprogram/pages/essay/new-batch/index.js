Page({
  data: {
    batchName: '',
    reviewRequirement: ''
  },

  onBatchNameInput(e) {
    this.setData({ batchName: e.detail.value });
  },

  onReviewRequirementInput(e) {
    this.setData({ reviewRequirement: e.detail.value });
  },

  createBatch() {
    const { batchName, reviewRequirement } = this.data;

    if (!batchName || !reviewRequirement) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.showLoading({ title: '创建中...' });

    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches`,
      method: 'POST',
      header: { Authorization: `Bearer ${token}` },
      data: { batchName, reviewRequirement },
      success: res => {
        wx.hideLoading();
        if (res.data.code === 0) {
          wx.showToast({ title: '创建成功', icon: 'success' });
          setTimeout(() => {
            wx.redirectTo({
              url: `/pages/essay/batch-detail/index?id=${res.data.data.id}`
            });
          }, 1000);
        } else {
          wx.showToast({ title: res.data.message || '创建失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  }
});