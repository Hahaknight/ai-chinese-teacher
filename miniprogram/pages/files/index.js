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
    const app = getApp();
    const token = wx.getStorageSync('token');
    const { filterType } = this.data;

    let url = `${app.globalData.baseUrl}/files`;
    if (filterType !== 'all') {
      url += `?type=${filterType}`;
    }

    wx.request({
      url,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ files: res.data.data });
        }
      }
    });
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