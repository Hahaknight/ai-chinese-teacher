Page({
  data: {
    keyword: '',
    selectedCategory: '全部',
    materials: [],
    loading: false
  },

  onLoad() {
    this.loadMaterials();
  },

  onShow() {
    this.loadMaterials();
  },

  loadMaterials() {
    this.setData({ loading: true });

    const app = getApp();
    const token = wx.getStorageSync('token');
    const { keyword, selectedCategory } = this.data;

    let url = `${app.globalData.baseUrl}/materials`;
    if (keyword || selectedCategory !== '全部') {
      url += `?keyword=${encodeURIComponent(keyword)}&category=${encodeURIComponent(selectedCategory)}`;
    }

    wx.request({
      url,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        this.setData({ loading: false });
        if (res.data.code === 0) {
          this.setData({ materials: res.data.data });
        }
      },
      fail: () => {
        this.setData({ loading: false });
        wx.showToast({ title: '加载失败', icon: 'none' });
      }
    });
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  search() {
    this.loadMaterials();
  },

  selectCategory(e) {
    const category = e.currentTarget.dataset.category;
    this.setData({ selectedCategory: category });
    this.loadMaterials();
  },

  goToDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/material/detail/index?id=${id}` });
  }
});