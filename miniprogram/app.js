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
    baseUrl: 'http://127.0.0.1:3000/api'
  },

  login() {
    // 本地 dev(baseUrl 是 127.0.0.1 / localhost)直接走 dev-login
    // 避免 /wechat/login 因 WECHAT_APP_ID 占位符返回 500 把控制台刷红
    if (/^http:\/\/(127\.0\.0\.1|localhost):/.test(this.globalData.baseUrl)) {
      this.devLogin();
      return;
    }

    wx.login({
      success: res => {
        if (res.code) {
          wx.request({
            url: `${this.globalData.baseUrl}/wechat/login`,
            method: 'POST',
            data: { code: res.code },
            success: res => {
              if (res.data && res.data.code === 0 && res.data.data && res.data.data.token) {
                this.setLoginData(res.data.data);
              } else {
                this.devLogin();
              }
            },
            fail: () => this.devLogin()
          });
        } else {
          this.devLogin();
        }
      },
      fail: () => this.devLogin()
    });
  },

  devLogin() {
    if (!/^http:\/\/(127\.0\.0\.1|localhost):3000\/api$/.test(this.globalData.baseUrl)) {
      return;
    }

    wx.request({
      url: `${this.globalData.baseUrl}/wechat/dev-login`,
      method: 'POST',
      data: { openId: 'miniprogram-local-dev' },
      success: res => {
        if (res.data.code === 0 && res.data.data.token) {
          this.setLoginData(res.data.data);
        }
      }
    });
  },

  setLoginData(data) {
    this.globalData.token = data.token;
    this.globalData.userInfo = data.user;
    wx.setStorageSync('token', data.token);
    wx.setStorageSync('userInfo', data.user);
  }
});
