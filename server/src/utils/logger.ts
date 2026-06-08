// 统一 logger:开发用 pino-pretty 单行输出,生产用 JSON 行
//
// 用法:
//   import { logger, createTaskLogger } from '../utils/logger';
//   logger.info({ ev: 'boot' }, '服务启动');
//   const taskLog = createTaskLogger(taskId);
//   taskLog.info({ page: 1 }, 'OCR 第 1 页');
//
// 设计:不打算一刀切替换 console.log,只在新代码 / 关键路径用 logger,
// 既有 console.log/warn/error 保持原样,改造成本太高且容易出 bug。

import pino from 'pino';

const isProd = process.env.NODE_ENV === 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // 生产输出 JSON 行(给采集器吃),开发用 pretty
  transport: isProd
    ? undefined
    : {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname'
        }
      },
  base: {
    // 生产场景默认 env / service 字段,采集器按这些分流
    env: process.env.NODE_ENV || 'development',
    service: 'ai-chinese-teacher-server'
  }
});

// 任务级 logger:把 taskId 自动带在所有日志里
// 用 child 复用 pino 的 fast path,比手动拼字符串便宜
export function createTaskLogger(taskId: string) {
  return logger.child({ taskId });
}

// 请求级 logger:把 reqId 自动带在所有日志里
export function createRequestLogger(reqId: string) {
  return logger.child({ reqId });
}
