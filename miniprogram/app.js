App({
  onLaunch() {
    // 展示本地存储能力
    const logs = wx.getStorageSync('logs') || [];
    logs.unshift(Date.now());
    wx.setStorageSync('logs', logs);

    // 登录
    this.login();
  },

  globalData: {
    userInfo: null,
    token: null,
    baseUrl: 'http://localhost:3000/api'
  },

  login() {
    wx.login({
      success: res => {
        if (res.code) {
          wx.request({
            url: `${this.globalData.baseUrl}/wechat/login`,
            method: 'POST',
            data: { code: res.code },
            success: res => {
              if (res.data.code === 0 && res.data.data.token) {
                this.globalData.token = res.data.data.token;
                this.globalData.userInfo = res.data.data.user;
                wx.setStorageSync('token', res.data.data.token);
                wx.setStorageSync('userInfo', res.data.data.user);
              }
            }
          });
        }
      }
    });
  }
});