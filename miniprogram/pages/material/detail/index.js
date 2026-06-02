const { request } = require('../../../utils/request');

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
    request({ url: `/materials/${this.data.id}`, hideLoading: true })
      .then(res => {
        this.setData({ material: res.data });
      })
      .catch(() => {});
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
    request({
      url: `/materials/${this.data.id}/favorite`,
      method: 'POST'
    })
      .then(res => {
        this.setData({ 'material.isFavorited': res.data.isFavorited });
        wx.showToast({
          title: res.data.isFavorited ? '已收藏' : '已取消',
          icon: 'success'
        });
      })
      .catch(() => {});
  }
});