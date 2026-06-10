const { request } = require('../../../utils/request');
const { BATCH_STATUS, TASK_STATUS } = require('../../../utils/config');
const { POLLING_INTERVAL_MS, POLLING_TIMEOUT_MS } = require('../../../utils/constants');

Page({
  data: {
    batchId: '',
    batch: {},
    tasks: []
  },

  // 保存轮询 interval id,onUnload 清理
  // 避免用户切到首页/讲评课等页面后,后台还在跑 poll 请求浪费后端 + 泄漏闭包
  _pollingInterval: null,

  onLoad(options) {
    this.setData({ batchId: options.id });
    this.loadBatchDetail();
  },

  onShow() {
    this.loadBatchDetail();
  },

  onUnload() {
    this._stopPolling();
  },

  _stopPolling() {
    if (this._pollingInterval) {
      clearInterval(this._pollingInterval);
      this._pollingInterval = null;
    }
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
    // 防止重复启动:旧轮询先停掉
    this._stopPolling();

    const startTime = Date.now();
    this._pollingInterval = setInterval(() => {
      if (Date.now() - startTime > POLLING_TIMEOUT_MS) {
        this._stopPolling();
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
            this._stopPolling();
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
    const task = (this.data.tasks || []).find(t => t.id === id);
    const studentLabel = (task && task.studentName) ? task.studentName : '该作文';
    wx.showModal({
      title: '重新批改',
      content: `将用当前已上传的图片重新请求 AI 批改 ${studentLabel} 的作文,继续吗?`,
      success: res => {
        if (!res.confirm) return;
        wx.showLoading({ title: '重新批改中...', mask: true });
        request({
          url: `/essay-batches/tasks/${id}/retry`,
          method: 'POST',
          data: {}
        })
          .then(() => {
            wx.hideLoading();
            wx.showToast({ title: '已重新提交', icon: 'success' });
            this.pollingStatus();
          })
          .catch(() => {
            wx.hideLoading();
            wx.showToast({ title: '重新批改失败', icon: 'none' });
          });
      }
    });
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