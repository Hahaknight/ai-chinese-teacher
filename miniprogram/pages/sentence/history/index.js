Page({
  data: {
    records: []
  },

  onLoad() {
    this.loadHistory();
  },

  loadHistory() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/sentence-fix/history`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ records: res.data.data });
        }
      }
    });
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/sentence/index/index?recordId=${id}` });
  }
});