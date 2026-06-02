const { request } = require('../../../utils/request');
const { BATCH_STATUS } = require('../../../utils/config');
const { formatDateShort } = require('../../../utils/format');

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
    request({ url: '/essay-batches', hideLoading: true })
      .then(res => {
        const batches = (res.data || [])
          .filter(b => b.status === 'completed' || b.status === 'partial')
          .map(b => ({
            ...b,
            statusText: BATCH_STATUS[b.status] || b.status
          }));
        this.setData({ batches });
      })
      .catch(() => {});

    request({ url: '/lecture-reviews', hideLoading: true })
      .then(res => {
        const lectures = (res.data || []).map(l => ({
          ...l,
          createdAtText: formatDateShort(l.createdAt)
        }));
        this.setData({ lectures });
      })
      .catch(() => {});
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
    request({
      url: '/lecture-reviews',
      method: 'POST',
      data: { batchId }
    })
      .then(res => {
        wx.showToast({ title: '生成成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateTo({ url: `/pages/lecture/detail/index?id=${res.data.id}` });
        }, 1000);
      })
      .catch(() => {});
  },

  goToLecture(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/lecture/detail/index?id=${id}` });
  }
});