const { request } = require('../../utils/request');
const { BATCH_STATUS } = require('../../utils/config');
const { formatFileSize, formatDateShort } = require('../../utils/format');

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
    request({ url: '/essay-batches/recent', hideLoading: true })
      .then(res => {
        const recentBatches = (res.data || []).map(b => ({
          ...b,
          statusText: BATCH_STATUS[b.status] || b.status
        }));
        this.setData({ recentBatches });
      })
      .catch(() => {});

    request({ url: '/files/recent', hideLoading: true })
      .then(res => {
        const recentFiles = (res.data || []).map(f => ({
          ...f,
          fileSizeText: formatFileSize(f.fileSize),
          createdAtText: formatDateShort(f.createdAt)
        }));
        this.setData({ recentFiles });
      })
      .catch(() => {});
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