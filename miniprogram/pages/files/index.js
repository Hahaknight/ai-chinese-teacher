const { request } = require('../../utils/request');
const { formatFileSize, formatDateShort } = require('../../utils/format');

Page({
  data: {
    filterType: 'all',
    files: []
  },

  onLoad() {
    this.loadFiles();
  },

  onShow() {
    this.loadFiles();
  },

  loadFiles() {
    const { filterType } = this.data;
    const url = filterType === 'all' ? '/files' : `/files?type=${filterType}`;

    request({ url, hideLoading: true })
      .then(res => {
        const files = (res.data || []).map(f => ({
          ...f,
          fileSizeText: formatFileSize(f.fileSize),
          createdAtText: formatDateShort(f.createdAt)
        }));
        this.setData({ files });
      })
      .catch(() => {});
  },

  setFilter(e) {
    const type = e.currentTarget.dataset.type;
    this.setData({ filterType: type });
    this.loadFiles();
  },

  openFile(e) {
    const url = e.currentTarget.dataset.url;
    if (!url) return;

    wx.showLoading({ title: '加载中...' });
    wx.downloadFile({
      url,
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
});