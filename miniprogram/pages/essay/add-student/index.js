Page({
  data: {
    batchId: '',
    taskId: '',
    studentName: '',
    images: [],
    isEdit: false
  },

  onLoad(options) {
    this.setData({
      batchId: options.batchId,
      taskId: options.taskId || ''
    });

    if (options.taskId) {
      this.setData({ isEdit: true });
      this.loadTask(options.taskId);
    }
  },

  loadTask(taskId) {
    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.request({
      url: `${app.globalData.baseUrl}/essay-batches/tasks/${taskId}`,
      header: { Authorization: `Bearer ${token}` },
      success: res => {
        if (res.data.code === 0) {
          const data = res.data.data;
          this.setData({
            studentName: data.studentName,
            images: JSON.parse(data.imageUrls || '[]')
          });
        }
      }
    });
  },

  onNameInput(e) {
    this.setData({ studentName: e.detail.value });
  },

  chooseImage() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: res => {
        const source = res.tapIndex === 0 ? 'camera' : 'album';
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sourceType: [source],
          success: res => {
            const tempFilePath = res.tempFiles[0].tempFilePath;
            this.uploadImage(tempFilePath);
          }
        });
      }
    });
  },

  uploadImage(filePath) {
    // In production, get presigned URL from server and upload to COS
    // For demo, we use local path
    const images = this.data.images;
    images.push(filePath);
    this.setData({ images });
  },

  deleteImage(e) {
    const index = e.currentTarget.dataset.index;
    const images = this.data.images;
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

    const app = getApp();
    const token = wx.getStorageSync('token');

    wx.showLoading({ title: '保存中...' });

    // For demo, use mock image URLs
    const mockImageUrls = images.map((_, i) => `https://example.com/images/${Date.now()}_${i}.jpg`);

    if (this.data.isEdit && this.data.taskId) {
      // Retry existing task
      wx.request({
        url: `${app.globalData.baseUrl}/essay-batches/tasks/${this.data.taskId}/retry`,
        method: 'POST',
        header: { Authorization: `Bearer ${token}` },
        data: { imageUrls: mockImageUrls },
        success: res => {
          wx.hideLoading();
          if (res.data.code === 0) {
            wx.showToast({ title: '已重新提交', icon: 'success' });
            setTimeout(() => {
              wx.navigateBack();
            }, 1000);
          } else {
            wx.showToast({ title: res.data.message || '保存失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
      });
    } else {
      // Create new task
      wx.request({
        url: `${app.globalData.baseUrl}/essay-batches/${batchId}/tasks`,
        method: 'POST',
        header: { Authorization: `Bearer ${token}` },
        data: { studentName, imageUrls: mockImageUrls },
        success: res => {
          wx.hideLoading();
          if (res.data.code === 0) {
            wx.showToast({ title: '保存成功', icon: 'success' });
            setTimeout(() => {
              if (isBack) {
                wx.navigateBack();
              } else {
                // Reset form for next student
                this.setData({
                  studentName: '',
                  images: []
                });
              }
            }, 1000);
          } else {
            wx.showToast({ title: res.data.message || '保存失败', icon: 'none' });
          }
        },
        fail: () => {
          wx.hideLoading();
          wx.showToast({ title: '网络错误', icon: 'none' });
        }
      });
    }
  }
});