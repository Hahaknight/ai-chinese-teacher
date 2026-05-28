Page({
  data: {
    recentBatches: [],
    recentFiles: []
  },

  onLoad() {
    this.loadRecentData();
  },

  onShow() {
    this.loadRecentData();
  },

  loadRecentData() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    // 获取最近批次
    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches/recent`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ recentBatches: res.data.data || [] });
        }
      }
    });

    // 获取最近文件
    wx.request({
      url: `${app.globalData.baseUrl}/files/recent`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ recentFiles: res.data.data || [] });
        }
      }
    });
  },

  goToEssayCorrection() {
    wx.navigateTo({ url: '/pages/essay/new-batch/index' });
  },

  goToSentenceFix() {
    wx.navigateTo({ url: '/pages/sentence/index/index' });
  },

  goToMaterialLibrary() {
    wx.navigateTo({ url: '/pages/material/index/index' });
  },

  goToLectureGenerator() {
    wx.navigateTo({ url: '/pages/lecture/index/index' });
  },

  goToBatchDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/essay/batch-detail/index?id=${id}` });
  },

  downloadFile(e) {
    const url = e.currentTarget.dataset.url;
    wx.showLoading({ title: '下载中...' });
    wx.downloadFile({
      url,
      success: res => {
        wx.hideLoading();
        wx.openDocument({
          filePath: res.tempFilePath,
          success: () => console.log('打开成功'),
          fail: err => {
            wx.hideLoading();
            wx.showToast({ title: '打开失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      }
    });
  }
});