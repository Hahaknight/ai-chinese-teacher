const { request } = require('../../../utils/request');
const { BATCH_STATUS } = require('../../../utils/config');

Page({
  data: {
    batches: []
  },

  onLoad() {
    this.loadBatches();
  },

  onShow() {
    this.loadBatches();
  },

  loadBatches() {
    request({ url: '/essay-batches', hideLoading: true })
      .then(res => {
        const batches = (res.data || []).map(b => ({
          ...b,
          statusText: BATCH_STATUS[b.status] || b.status
        }));
        this.setData({ batches });
      })
      .catch(() => {});
  },

  goToBatchDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/essay/batch-detail/index?id=${id}` });
  }
});