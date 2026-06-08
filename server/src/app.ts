// 必须在所有其他 import 之前加载 .env,让 MINIMAX_API_KEY 等环境变量在模块初始化时可用
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { initDatabase } from './utils/db';
import { closeBrowser } from './utils/pdf';
import { startCleanupSchedule, stopCleanupSchedule } from './utils/cleanup';
import { logger } from './utils/logger';
import { requestIdMiddleware } from './middlewares/requestId';
import authRoutes from './routes/auth';
import essayRoutes from './routes/essay';
import sentenceRoutes from './routes/sentence';
import materialRoutes from './routes/material';
import lectureRoutes from './routes/lecture';
import fileRoutes, { UPLOAD_DIR } from './routes/file';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());

// 显式声明 TRUST_PROXY 时,让 express 信任代理转发的 X-Forwarded-* / Host
// 不声明就保持 false —— 否则任何客户端都能伪造 host 头影响 toPublicFileUrl 等
if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', true);
  logger.info('trust proxy enabled (TRUST_PROXY=1)');
}

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(requestIdMiddleware);

// Serve uploaded files locally
app.use('/uploads', express.static(UPLOAD_DIR));

// Routes
app.use('/api/wechat', authRoutes);
app.use('/api/essay-batches', essayRoutes);
app.use('/api/sentence-fix', sentenceRoutes);
app.use('/api/materials', materialRoutes);
app.use('/api/lecture-reviews', lectureRoutes);
app.use('/api/files', fileRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ code: 0, message: 'OK' });
});

// Error handling
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  logger.error({ err: err.message, stack: err.stack, path: req.path }, 'unhandled error');
  res.status(500).json({ code: 500, message: err.message || 'Internal server error' });
});

// Initialize database and start server
const HOST = process.env.HOST || '0.0.0.0';

initDatabase().then(() => {
  const server = app.listen(Number(PORT), HOST, () => {
    logger.info({ host: HOST, port: PORT }, `Server is running on http://${HOST}:${PORT}`);
  });

  // 启动文件清理调度:temp 1 天前 / uploads 7 天前孤儿
  const TEMP_DIR = process.env.TEMP_DIR || path.join(process.cwd(), 'temp');
  startCleanupSchedule({ tempDir: TEMP_DIR, uploadsDir: UPLOAD_DIR });

  // 进程退出时关 puppeteer browser,避免 chromium 孤儿进程
  const shutdown = async (signal: string) => {
    logger.info({ signal }, `${signal} received, shutting down...`);
    stopCleanupSchedule();
    server.close(() => logger.info('HTTP server closed'));
    await closeBrowser().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}).catch(err => {
  logger.fatal({ err: err.message }, 'Failed to initialize database');
  process.exit(1);
});

export default app;
