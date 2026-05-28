Page({
  data: {
    materials: []
  },

  onLoad() {
    this.loadFavorites();
  },

  onShow() {
    this.loadFavorites();
  },

  loadFavorites() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/materials/favorites/list`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ materials: res.data.data });
        }
      }
    });
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/material/detail/index?id=${id}` });
  }
});