const { request } = require('../../../utils/request');
const { BATCH_STATUS, TASK_STATUS } = require('../../../utils/config');
const { POLLING_INTERVAL_MS, POLLING_TIMEOUT_MS } = require('../../../utils/constants');

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
    request({ url: `/essay-batches/${this.data.batchId}`, hideLoading: true })
      .then(res => {
        const data = res.data;
        const statusText = BATCH_STATUS[data.status] || data.status;
        const tasks = (data.tasks || []).map(t => ({
          ...t,
          statusText: TASK_STATUS[t.status] || t.status
        }));
        this.setData({
          batch: { ...data, statusText },
          tasks
        });
      })
      .catch(() => {});
  },

  addStudent() {
    wx.navigateTo({
      url: `/pages/essay/add-student/index?batchId=${this.data.batchId}`
    });
  },

  startCorrection() {
    wx.showModal({
      title: '确认开始',
      content: '确定要开始批量批改吗？批改过程可能需要几分钟。',
      success: res => {
        if (!res.confirm) return;
        request({
          url: `/essay-batches/${this.data.batchId}/start`,
          method: 'POST'
        })
          .then(() => {
            wx.showToast({ title: '已开始批改', icon: 'success' });
            this.pollingStatus();
          })
          .catch(() => {});
      }
    });
  },

  pollingStatus() {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
        clearInterval(interval);
        wx.showToast({ title: '轮询超时,请手动刷新', icon: 'none' });
        return;
      }

      request({ url: `/essay-batches/${this.data.batchId}`, hideLoading: true })
        .then(res => {
          const data = res.data;
          const statusText = BATCH_STATUS[data.status] || data.status;
          const tasks = (data.tasks || []).map(t => ({
            ...t,
            statusText: TASK_STATUS[t.status] || t.status
          }));
          this.setData({ batch: { ...data, statusText }, tasks });

          if (data.status !== 'processing') {
            clearInterval(interval);
            if (data.status === 'completed') {
              wx.showToast({ title: '批改完成', icon: 'success' });
            } else if (data.status === 'partial') {
              wx.showToast({ title: '部分完成', icon: 'warn' });
            } else if (data.status === 'failed') {
              wx.showToast({ title: '批改失败', icon: 'none' });
            }
          }
        })
        .catch(() => {});
    }, POLLING_INTERVAL_MS);
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
  },

  deleteBatch() {
    const batchName = (this.data.batch && this.data.batch.batchName) || '此批次';
    wx.showModal({
      title: '确认删除',
      content: `删除"${batchName}"后,该批次下的所有学生作文和评分将无法恢复。确定要删除吗?`,
      confirmText: '删除',
      confirmColor: '#e54d42',
      success: res => {
        if (!res.confirm) return;
        request({
          url: `/essay-batches/${this.data.batchId}`,
          method: 'DELETE'
        })
          .then(() => {
            wx.showToast({ title: '已删除', icon: 'success' });
            setTimeout(() => {
              wx.navigateBack();
            }, 800);
          })
          .catch(() => {});
      }
    });
  }
});