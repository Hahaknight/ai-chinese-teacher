// 集中常量
// 这里放一些不常变、跨页面引用的常量
// 状态文案等已移到 config.js(BATCH_STATUS / TASK_STATUS)

// 单个学生最多图片数
const MAX_IMAGES_PER_STUDENT = 3;

// 单张图片最大 20MB(后端 multer 限制)
const MAX_IMAGE_SIZE_MB = 20;

// 文件名最大长度(用于下载的 wordUrl 文件名)
const FILE_NAME_MAX_LENGTH = 50;

// 轮询间隔(ms)
const POLLING_INTERVAL_MS = 3000;

// 轮询最长持续时间(ms)
const POLLING_TIMEOUT_MS = 5 * 60 * 1000;

module.exports = {
  MAX_IMAGES_PER_STUDENT,
  MAX_IMAGE_SIZE_MB,
  FILE_NAME_MAX_LENGTH,
  POLLING_INTERVAL_MS,
  POLLING_TIMEOUT_MS
};
