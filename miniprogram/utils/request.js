// 统一 wx.request 封装:自动注入 token、拦截 401、统一错误提示
// 用法: const { request } = require('../../utils/request');
//       const res = await request({ url: '/essay-batches', method: 'POST', data: {...} });

const { BASE_URL } = require('./config');

function getToken() {
  try {
    return wx.getStorageSync('token') || '';
  } catch (e) {
    return '';
  }
}

function setToken(token, userInfo) {
  if (token) wx.setStorageSync('token', token);
  if (userInfo) wx.setStorageSync('userInfo', userInfo);
}

function clearToken() {
  wx.removeStorageSync('token');
  wx.removeStorageSync('userInfo');
}

function isLoggedIn() {
  return !!getToken();
}

// 通用请求 timeout(AI 批改可能跑 5 分钟,但普通 CRUD 30s 足够)
const DEFAULT_TIMEOUT_MS = 30000;

function request({ url, method = 'GET', data = {}, header = {}, hideLoading = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const fullUrl = url.startsWith('http') ? url : `${BASE_URL}${url}`;
    const token = getToken();
    const finalHeader = Object.assign(
      { 'Content-Type': 'application/json' },
      token ? { Authorization: `Bearer ${token}` } : {},
      header
    );

    if (!hideLoading) {
      wx.showLoading({ title: '加载中', mask: true });
    }

    wx.request({
      url: fullUrl,
      method,
      data,
      header: finalHeader,
      timeout: timeoutMs || DEFAULT_TIMEOUT_MS,
      success: (res) => {
        if (!hideLoading) wx.hideLoading();

        if (res.statusCode === 401) {
          clearToken();
          wx.showToast({ title: '登录已过期,请重新进入', icon: 'none' });
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/index/index' });
          }, 1500);
          return reject({ code: 401, message: 'Unauthorized' });
        }

        const body = res.data || {};
        if (body.code === 0) {
          resolve(body);
        } else {
          if (!hideLoading) {
            wx.showToast({ title: body.message || '请求失败', icon: 'none' });
          }
          reject(body);
        }
      },
      fail: (err) => {
        if (!hideLoading) wx.hideLoading();
        const isTimeout = err && (err.errMsg || '').includes('timeout');
        wx.showToast({ title: isTimeout ? '请求超时,请重试' : '网络错误', icon: 'none' });
        reject(err);
      }
    });
  });
}

module.exports = { request, getToken, setToken, clearToken, isLoggedIn };
