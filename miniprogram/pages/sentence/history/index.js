const { request } = require('../../../utils/request');
const { formatDateShort } = require('../../../utils/format');

Page({
  data: {
    records: []
  },

  onLoad() {
    this.loadHistory();
  },

  loadHistory() {
    request({ url: '/sentence-fix/history', hideLoading: true })
      .then(res => {
        const records = (res.data || []).map(r => ({
          ...r,
          createdAtText: formatDateShort(r.createdAt)
        }));
        this.setData({ records });
      })
      .catch(() => {});
  },

  viewDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/sentence/index/index?recordId=${id}` });
  }
});