const { request } = require('../../../utils/request');

Page({
  data: {
    taskId: '',
    task: {},
    editingName: false,
    customName: ''
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

  // 点候选名 → 直接保存
  pickCandidate(e) {
    const name = e.currentTarget.dataset.name;
    if (!name) return;
    this._saveName(name);
  },

  // 切到自定义输入模式
  startCustomName() {
    this.setData({ editingName: true, customName: this.data.task.studentName || '' });
  },

  onCustomNameInput(e) {
    this.setData({ customName: e.detail.value });
  },

  cancelCustomName() {
    this.setData({ editingName: false, customName: '' });
  },

  submitCustomName() {
    const name = (this.data.customName || '').trim();
    if (!name) {
      wx.showToast({ title: '姓名不能为空', icon: 'none' });
      return;
    }
    this._saveName(name);
  },

  _saveName(name) {
    wx.showLoading({ title: '保存中...' });
    request({
      url: `/essay-batches/tasks/${this.data.taskId}/name`,
      method: 'PATCH',
      data: { studentName: name }
    })
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已保存', icon: 'success' });
        this.setData({
          editingName: false,
          customName: '',
          'task.studentName': name,
          'task.nameMissing': false
        });
      })
      .catch((err) => {
        wx.hideLoading();
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
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