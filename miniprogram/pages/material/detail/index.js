Page({
  data: {
    id: '',
    material: {}
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.loadMaterialDetail();
  },

  loadMaterialDetail() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/materials/${this.data.id}`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ material: res.data.data });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      }
    });
  },

  copyParagraph() {
    wx.setClipboardData({
      data: this.data.material.sampleParagraph,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  toggleFavorite() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/materials/${this.data.id}/favorite`,
      method: 'POST',
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({
            'material.isFavorited': res.data.data.isFavorited
          });
          wx.showToast({
            title: res.data.data.isFavorited ? '已收藏' : '已取消',
            icon: 'success'
          });
        }
      }
    });
  }
});