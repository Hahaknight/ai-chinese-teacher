const { request } = require('../../../utils/request');

Page({
  data: {
    taskId: '',
    task: {}
  },

  onLoad(options) {
    this.setData({ taskId: options.taskId });
    this.loadTaskDetail();
  },

  loadTaskDetail() {
    request({ url: `/essay-batches/tasks/${this.data.taskId}`, hideLoading: true })
      .then(res => {
        this.setData({ task: res.data });
      })
      .catch(() => {});
  },

  copyComment() {
    wx.setClipboardData({
      data: this.data.task.shortComment,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  exportWord() {
    this._downloadAndOpen(this.data.task.wordUrl);
  },

  exportPDF() {
    this._downloadAndOpen(this.data.task.pdfUrl);
  },

  _downloadAndOpen(url) {
    if (!url) return;
    wx.showLoading({ title: '下载中...' });
    wx.downloadFile({
      url,
      success: res => {
        wx.hideLoading();
        wx.openDocument({
          filePath: res.tempFilePath,
          fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      }
    });
  },

  retryTask() {
    wx.navigateTo({
      url: `/pages/essay/add-student/index?batchId=${this.data.task.batchId}&taskId=${this.data.taskId}`
    });
  }
});