import express from 'express';
import cors from 'cors';
import { initDatabase } from './utils/db';
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
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
  console.error('Error:', err);
  res.status(500).json({ code: 500, message: err.message || 'Internal server error' });
});

// Initialize database and start server
const HOST = process.env.HOST || '0.0.0.0';

initDatabase().then(() => {
  app.listen(Number(PORT), HOST, () => {
    console.log(`Server is running on http://${HOST}:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

export default app;
