Page({
  data: {
    batches: [],
    lectures: []
  },

  onLoad() {
    this.loadData();
  },

  onShow() {
    this.loadData();
  },

  loadData() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    // Get batches with completed status
    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          const batches = res.data.data.filter(b =>
            b.status === 'completed' || b.status === 'partial'
          ).map(b => ({
            ...b,
            statusText: b.status === 'completed' ? '已完成' : '部分完成'
          }));
          this.setData({ batches });
        }
      }
    });

    // Get lecture reviews
    wx.request({
      url: `${app.globalData.baseUrl}/lecture-reviews`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ lectures: res.data.data });
        }
      }
    });
  },

  selectBatch(e) {
    const batchId = e.currentTarget.dataset.id;

    wx.showModal({
      title: '确认生成',
      content: '确定要基于该批次生成讲评课吗？',
      success: res => {
        if (res.confirm) {
          this.generateLecture(batchId);
        }
      }
    });
  },

  generateLecture(batchId) {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.showLoading({ title: '生成中...' });

    wx.request({
      url: `${app.globalData.baseUrl}/lecture-reviews`,
      method: 'POST',
      header: { Authorization: `Bearer ${token}` },
      data: { batchId },
      success: res => {
        wx.hideLoading();
        if (res.data.code === 0) {
          wx.showToast({ title: '生成成功', icon: 'success' });
          setTimeout(() => {
            wx.navigateTo({ url: `/pages/lecture/detail/index?id=${res.data.data.id}` });
          }, 1000);
        } else {
          wx.showToast({ title: res.data.message || '生成失败', icon: 'none' });
        }
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '网络错误', icon: 'none' });
      }
    });
  },

  goToLecture(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/lecture/detail/index?id=${id}` });
  }
});