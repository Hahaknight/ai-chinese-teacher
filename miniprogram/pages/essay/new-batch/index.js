const { request } = require('../../../utils/request');
const { EXAM_MODE_PROMPT, DAILY_MODE_PROMPT } = require('../../../utils/prompts');

const DEFAULT_BATCH_NAME = '命题作文:中国符号';

Page({
  data: {
    batchName: DEFAULT_BATCH_NAME,
    reviewRequirement: ''
  },

  onBatchNameInput(e) {
    this.setData({ batchName: e.detail.value });
  },

  onReviewRequirementInput(e) {
    this.setData({ reviewRequirement: e.detail.value });
  },

  // 点击"改卷模式"/"日常模式"按钮 → 弹确认 → 替换输入框内容
  // B1 方案:已有内容时弹 modal,防止误点丢数据
  applyPromptPreset(e) {
    const mode = e.currentTarget.dataset.mode;
    const preset = mode === 'exam' ? EXAM_MODE_PROMPT : DAILY_MODE_PROMPT;
    const modeName = mode === 'exam' ? '改卷模式' : '日常模式';

    const apply = () => this.setData({ reviewRequirement: preset });

    if (this.data.reviewRequirement && this.data.reviewRequirement.trim().length > 0) {
      wx.showModal({
        title: '替换批改要求',
        content: `当前输入框已有内容,选择"${modeName}"将覆盖现有内容,继续吗?`,
        success: res => { if (res.confirm) apply(); }
      });
    } else {
      apply();
    }
  },

  createBatch() {
    const { batchName, reviewRequirement } = this.data;

    if (!batchName || !reviewRequirement) {
      wx.showToast({ title: '请填写完整信息', icon: 'none' });
      return;
    }

    request({
      url: '/essay-batches',
      method: 'POST',
      data: { batchName, reviewRequirement }
    })
      .then(res => {
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => {
          wx.redirectTo({
            url: `/pages/essay/batch-detail/index?id=${res.data.id}`
          });
        }, 1000);
      })
      .catch(() => {});
  }
});