const { request } = require('../../../utils/request');

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

    request({
      url: '/essay-batches',
      method: 'POST',
      data: { batchName, reviewRequirement }
    })
      .then(res => {
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/essay/batch-detail/index?id=${res.data.id}`
          });
        }, 1000);
      })
      .catch(() => {});
  }
});