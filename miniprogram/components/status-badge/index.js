// 状态徽章:作文批次/任务通用
// status -> { text, cls } 一次性映射,避免每个页面写一长串三元
// 用法: <status-badge status="completed" text="已完成" />
Component({
  options: { multipleSlots: false },
  properties: {
    status: { type: String, value: 'pending' },
    // 可选,不传时按 status 默认中文映射
    text: { type: String, value: '' }
  },
  data: {
    // 默认文案映射 (batch 用)
    defaultText: {
      pending: '待批改',
      processing: '批改中',
      completed: '已完成',
      partial: '部分完成',
      failed: '批改失败',
      success: '成功'
    }
  },
  computed: {},
  observers: {},
  methods: {
    statusClass() {
      const s = this.data.status;
      // success 在 task 维度也存在,映射到 completed 的绿色
      if (s === 'completed' || s === 'success') return 'badge-completed';
      if (s === 'processing') return 'badge-processing';
      if (s === 'partial') return 'badge-partial';
      if (s === 'failed') return 'badge-failed';
      return 'badge-pending';
    }
  }
});
