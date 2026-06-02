// 登录态管理
const { getToken, setToken, clearToken, isLoggedIn } = require('./request');

function getUserInfo() {
  try {
    return wx.getStorageSync('userInfo') || null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  getToken,
  setToken,
  clearToken,
  isLoggedIn,
  getUserInfo
};
