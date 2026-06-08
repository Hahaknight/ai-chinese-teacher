// 分数显示:作文批改总分/单项分通用
// 用法: <score-display score="42" full-score="50" />
Component({
  properties: {
    score: { type: null, value: null },
    fullScore: { type: null, value: null },
    // 'large' 用在 report 头部 (字号 48rpx) / 'normal' 用在列表项 (36rpx)
    size: { type: String, value: 'normal' }
  }
});
