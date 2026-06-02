const { request, getToken } = require('../../../utils/request');
const { MAX_IMAGES_PER_STUDENT } = require('../../../utils/constants');

function uploadImage(filePath) {
  return new Promise((resolve, reject) => {
    const { BASE_URL } = require('../../../utils/config');
    const token = getToken();
    wx.showLoading({ title: '上传中...', mask: true });
    wx.uploadFile({
      url: `${BASE_URL}/files/upload`,
      filePath,
      name: 'file',
      header: token ? { Authorization: `Bearer ${token}` } : {},
      success: res => {
        wx.hideLoading();
        let body;
        try {
          body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data;
        } catch (err) {
          return reject(new Error('上传响应解析失败'));
        }
        if (body && body.code === 0 && body.data && body.data.fileUrl) {
          resolve(body.data);
        } else {
          reject(new Error((body && body.message) || '上传失败'));
        }
      },
      fail: err => {
        wx.hideLoading();
        reject(err);
      }
    });
  });
}

Page({
  data: {
    batchId: '',
    taskId: '',
    studentName: '',
    images: [],
    isEdit: false
  },

  onLoad(options) {
    const isEdit = !!(options && options.taskId);
    this.setData({
      batchId: options.batchId,
      taskId: options.taskId || '',
      isEdit
    });
    wx.setNavigationBarTitle({ title: isEdit ? '编辑学生作文' : '添加学生作文' });

    if (isEdit) {
      this.loadTask(options.taskId);
    }
  },

  loadTask(taskId) {
    request({ url: `/essay-batches/tasks/${taskId}`, hideLoading: true })
      .then(res => {
        const data = res.data;
        this.setData({
          studentName: data.studentName,
          images: this.parseImageUrls(data.imageUrls)
        });
      })
      .catch(() => {});
  },

  parseImageUrls(raw) {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  },

  onNameInput(e) {
    this.setData({ studentName: e.detail.value });
  },

  chooseImage() {
    if (this.data.images.length >= MAX_IMAGES_PER_STUDENT) {
      wx.showToast({ title: `最多 ${MAX_IMAGES_PER_STUDENT} 张图片`, icon: 'none' });
      return;
    }
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: res => {
        const source = res.tapIndex === 0 ? 'camera' : 'album';
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: [source],
          success: chooseRes => {
            const tempFilePath = chooseRes.tempFiles[0].tempFilePath;
            this.doUpload(tempFilePath);
          }
        });
      }
    });
  },

  doUpload(filePath) {
    uploadImage(filePath)
      .then(data => {
        const images = this.data.images.concat([data.fileUrl]);
        this.setData({ images });
      })
      .catch(err => {
        wx.showToast({ title: err.message || '上传失败', icon: 'none' });
      });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images.slice();
    images.splice(index, 1);
    this.setData({ images });
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index;
    wx.previewImage({
      urls: this.data.images,
      current: this.data.images[index]
    });
  },

  saveAndContinue() {
    this.saveAndNavigate(true);
  },

  saveAndAddNext() {
    this.saveAndNavigate(false);
  },

  saveAndNavigate(isBack) {
    const { batchId, studentName, images } = this.data;

    if (!studentName) {
      wx.showToast({ title: '请输入学生姓名', icon: 'none' });
      return;
    }
    if (images.length === 0) {
      wx.showToast({ title: '请上传至少一张作文图片', icon: 'none' });
      return;
    }

    const onSuccess = () => {
      wx.showToast({ title: this.data.isEdit ? '已重新提交' : '保存成功', icon: 'success' });
      setTimeout(() => {
        if (this.data.isEdit || isBack) {
          wx.navigateBack();
        } else {
          this.setData({ studentName: '', images: [] });
        }
      }, 1000);
    };

    if (this.data.isEdit && this.data.taskId) {
      request({
        url: `/essay-batches/tasks/${this.data.taskId}/retry`,
        method: 'POST',
        data: { imageUrls: images }
      })
        .then(onSuccess)
        .catch(() => {});
    } else {
      request({
        url: `/essay-batches/${batchId}/tasks`,
        method: 'POST',
        data: { studentName, imageUrls: images }
      })
        .then(onSuccess)
        .catch(() => {});
    }
  }
});
