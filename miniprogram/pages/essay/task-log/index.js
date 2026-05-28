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
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          const statusMap = {
            'pending': '待批改',
            'processing': '批改中',
            'completed': '已完成',
            'partial': '部分完成',
            'failed': '失败'
          };
          const batches = res.data.data.map(b => ({
            ...b,
            statusText: statusMap[b.status] || b.status
          }));
          this.setData({ batches });
        }
      }
    });
  },

  goToBatchDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/essay/batch-detail/index?id=${id}` });
  }
});