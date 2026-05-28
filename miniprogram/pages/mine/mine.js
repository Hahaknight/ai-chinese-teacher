Page({
  data: {
    userInfo: null
  },

  onLoad() {
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ userInfo: userInfo || {} });
  },

  onShow() {
    const userInfo = wx.getStorageSync('userInfo');
    this.setData({ userInfo: userInfo || {} });
  },

  goToEssayRecords() {
    wx.navigateTo({ url: '/pages/essay/task-log/index' });
  },

  goToLectureRecords() {
    wx.navigateTo({ url: '/pages/lecture/index/index' });
  },

  goToSentenceHistory() {
    wx.navigateTo({ url: '/pages/sentence/history/index' });
  },

  goToFavoriteMaterials() {
    wx.navigateTo({ url: '/pages/material/favorites/index' });
  },

  goToFiles() {
    wx.navigateTo({ url: '/pages/files/index' });
  },

  goToSettings() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  goToHelp() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  },

  goToAbout() {
    wx.showToast({ title: '功能开发中', icon: 'none' });
  }
});