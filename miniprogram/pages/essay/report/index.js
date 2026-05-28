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
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches/tasks/${this.data.taskId}`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ task: res.data.data });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      }
    });
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
    const wordUrl = this.data.task.wordUrl;
    if (wordUrl) {
      wx.showLoading({ title: '下载中...' });
      wx.downloadFile({
        url: wordUrl,
        success: res => {
          wx.hideLoading();
          wx.openDocument({
            filePath: res.tempFilePath,
            success: () => console.log('打开成功'),
            fail: () => {
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
  },

  exportPDF() {
    const pdfUrl = this.data.task.pdfUrl;
    if (pdfUrl) {
      wx.showLoading({ title: '下载中...' });
      wx.downloadFile({
        url: pdfUrl,
        success: res => {
          wx.hideLoading();
          wx.openDocument({
            filePath: res.tempFilePath,
            success: () => console.log('打开成功'),
            fail: () => {
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
  },

  retryTask() {
    wx.navigateTo({
      url: `/pages/essay/add-student/index?batchId=${this.data.task.batchId}&taskId=${this.data.taskId}`
    });
  }
});