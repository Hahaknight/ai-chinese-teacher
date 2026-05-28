Page({
  data: {
    batchId: '',
    batch: {},
    tasks: []
  },

  onLoad(options) {
    this.setData({ batchId: options.id });
    this.loadBatchDetail();
  },

  onShow() {
    this.loadBatchDetail();
  },

  loadBatchDetail() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches/${this.data.batchId}`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          const data = res.data.data;
          const statusMap = {
            'pending': '待批改',
            'processing': '批改中',
            'completed': '已完成',
            'partial': '部分完成',
            'failed': '失败'
          };
          const statusText = statusMap[data.status] || data.status;

          const tasks = data.tasks.map(t => ({
            ...t,
            statusText: statusMap[t.status] || t.status
          }));

          this.setData({
            batch: {
              ...data,
              statusText
            },
            tasks
          });
        }
      }
    });
  },

  addStudent() {
    wx.navigateTo({
      url: `/pages/essay/add-student/index?batchId=${this.data.batchId}`
    });
  },

  startCorrection() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.showModal({
      title: '确认开始',
      content: '确定要开始批量批改吗？批改过程可能需要几分钟。',
      success: res => {
        if (res.confirm) {
          wx.showLoading({ title: '提交中...' });
          wx.request({
            url: `${app.globalData.baseUrl}/essay-batches/${this.data.batchId}/start`,
            method: 'POST',
            header: { Authorization: `Bearer ${token}` },
            success: res => {
              wx.hideLoading();
              if (res.data.code === 0) {
                wx.showToast({ title: '已开始批改', icon: 'success' });
                this.pollingStatus();
              } else {
                wx.showToast({ title: res.data.message || '提交失败', icon: 'none' });
              }
            },
            fail: () => {
              wx.hideLoading();
              wx.showToast({ title: '网络错误', icon: 'none' });
            }
          });
        }
      }
    });
  },

  pollingStatus() {
    const interval = setInterval(() => {
      this.loadBatchDetail();
      if (this.data.batch.status !== 'processing') {
        clearInterval(interval);
        if (this.data.batch.status === 'completed') {
          wx.showToast({ title: '批改完成', icon: 'success' });
        } else if (this.data.batch.status === 'partial') {
          wx.showToast({ title: '部分完成', icon: 'warn' });
        }
      }
    }, 3000);

    // Stop polling after 5 minutes
    setTimeout(() => clearInterval(interval), 300000);
  },

  goToTask(e) {
    const id = e.currentTarget.dataset.id;
    const status = e.currentTarget.dataset.status;
    if (status === 'success') {
      wx.navigateTo({ url: `/pages/essay/report/index?taskId=${id}` });
    }
  },

  retryTask(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/essay/add-student/index?batchId=${this.data.batchId}&taskId=${id}` });
  }
});