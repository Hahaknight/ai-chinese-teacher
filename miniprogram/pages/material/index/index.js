const { request } = require('../../../utils/request');
const { MATERIAL_CATEGORIES } = require('../../../utils/config');

Page({
  data: {
    keyword: '',
    selectedCategory: '全部',
    categories: ['全部'].concat(MATERIAL_CATEGORIES),
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

    const { keyword, selectedCategory } = this.data;
    const params = [];
    if (keyword) params.push(`keyword=${encodeURIComponent(keyword)}`);
    if (selectedCategory !== '全部') params.push(`category=${encodeURIComponent(selectedCategory)}`);
    const url = params.length ? `/materials?${params.join('&')}` : '/materials';

    request({ url, hideLoading: true })
      .then(res => {
        this.setData({ materials: res.data || [], loading: false });
      })
      .catch(() => {
        this.setData({ loading: false });
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