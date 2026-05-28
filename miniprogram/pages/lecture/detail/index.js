Page({
  data: {
    id: '',
    lecture: {}
  },

  onLoad(options) {
    this.setData({ id: options.id });
    this.loadLectureDetail();
  },

  loadLectureDetail() {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/lecture-reviews/${this.data.id}`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          this.setData({ lecture: res.data.data });
        } else {
          wx.showToast({ title: '加载失败', icon: 'none' });
        }
      }
    });
  },

  copyAll() {
    const { lecture } = this.data;
    const content = lecture.content;

    let text = `${lecture.title}\n\n`;
    text += `一、本次作文整体情况\n${content.overallSituation}\n\n`;
    text += `二、本次作文主要优点\n${content.mainStrengths.map(s => '• ' + s).join('\n')}\n\n`;
    text += `三、本次作文共性问题\n${content.commonProblems.map(p => '• ' + p).join('\n')}\n\n`;
    text += `四、典型问题讲解\n${content.typicalProblemExplanation.map(t => `问题：${t.problem}\n原因：${t.reason}\n方法：${t.method}`).join('\n\n')}\n\n`;
    text += `五、优秀表达赏析\n${content.excellentExpressions.map(e => '【示例】\n' + e).join('\n\n')}\n\n`;
    text += `六、课堂修改练习\n${content.classPractice.map(p => `练习：${p.exercise}\n引导：${p.guide}\n参考答案：${p.answer}`).join('\n\n')}\n\n`;
    text += `七、课后提升建议\n${content.afterClassSuggestions.map(s => '• ' + s).join('\n')}`;

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  exportWord() {
    const wordUrl = this.data.lecture.wordUrl;
    if (wordUrl) {
      wx.showLoading({ title: '下载中...' });
      wx.downloadFile({
        url: wordUrl,
        success: res => {
          wx.hideLoading();
          wx.openDocument({
            filePath: res.tempFilePath,
            success: () => console.log('打开成功'),
            fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '下载失败', icon: 'none' });
        }
      });
    }
  },

  exportPDF() {
    const pdfUrl = this.data.lecture.pdfUrl;
    if (pdfUrl) {
      wx.showLoading({ title: '下载中...' });
      wx.downloadFile({
        url: pdfUrl,
        success: res => {
          wx.hideLoading();
          wx.openDocument({
            filePath: res.tempFilePath,
            success: () => console.log('打开成功'),
            fail: () => wx.showToast({ title: '打开失败', icon: 'none' })
          });
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '下载失败', icon: 'none' });
        }
      });
    }
  }
});