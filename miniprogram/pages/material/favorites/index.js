const { request } = require('../../../utils/request');

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
    request({ url: '/materials/favorites/list', hideLoading: true })
      .then(res => {
        this.setData({ materials: res.data || [] });
      })
      .catch(() => {});
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/material/detail/index?id=${id}` });
  }
});