// 通用格式化工具

/**
 * 字节数转人类可读大小
 * 1234 -> "1.2 KB"
 * 1234567 -> "1.2 MB"
 * 0 / null / undefined -> "未知大小"
 */
function formatFileSize(bytes) {
  if (bytes === null || bytes === undefined || bytes === '') return '未知大小';
  const n = Number(bytes);
  if (!isFinite(n) || n < 0) return '未知大小';
  if (n === 0) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + ' MB';
  return (n / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
}

/**
 * 截断文件名,保留扩展名
 * "这是一份非常长的作文讲评课讲评课讲评课讲评课讲评课讲评课讲评课.docx" -> "这是一份非常长的作文讲评课讲评课讲评课讲评课讲...docx"
 */
function truncateFileName(name, max = 50) {
  if (!name) return '';
  if (name.length <= max) return name;
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot < 4) return name.slice(0, max - 1) + '…';
  const ext = name.slice(dot);
  return name.slice(0, max - ext.length - 1) + '…' + ext;
}

/**
 * ISO 时间字符串 -> 简短中文格式
 * "2026-06-02T03:14:15.000Z" -> "06-02 11:14"
 * 入参非 ISO 字符串则原样返回
 */
function formatDateShort(iso) {
  if (!iso || typeof iso !== 'string') return iso || '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const pad = n => (n < 10 ? '0' + n : '' + n);
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

module.exports = {
  formatFileSize,
  truncateFileName,
  formatDateShort
};
