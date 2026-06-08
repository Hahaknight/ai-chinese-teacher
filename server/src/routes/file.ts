import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { logger } from '../utils/logger';

const router = Router();
router.use(authMiddleware);

// Ensure upload directory exists
export const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname) || '.jpg';
    const baseName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9一-龥]/g, '_') || 'upload';
    cb(null, `${Date.now()}_${baseName}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      cb(new Error('Only image files are allowed'));
      return;
    }
    cb(null, true);
  }
});

// 安全开关:只有显式声明 TRUST_PROXY=1 时,才把 X-Forwarded-Proto / Host 当作可信来源
// 默认关闭 —— 否则任何客户端都可以通过伪造 Host 头让返回的 fileUrl 指向恶意域名
function isProxyTrusted(): boolean {
  return process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';
}

function getBaseUrl(req?: AuthRequest): string {
  const configured = process.env.PUBLIC_BASE_URL || process.env.SERVER_PUBLIC_URL;
  if (configured) {
    return configured.replace(/\/api$/, '').replace(/\/$/, '');
  }

  if (req && isProxyTrusted()) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  // 未配置 PUBLIC_BASE_URL 且未声明 TRUST_PROXY,回退到 localhost
  // 这种情况下 fileUrl 里的 host 仍然是 localhost,真机扫码会访问不到 —— 用户应配置 PUBLIC_BASE_URL
  if (req && !isProxyTrusted() && (req.headers['x-forwarded-proto'] || req.headers.host)) {
    logger.debug(
      { host: req.headers.host, forwardedProto: req.headers['x-forwarded-proto'] },
      '[file] toPublicFileUrl 忽略代理头:未设置 TRUST_PROXY=1,如已部署反代请在 .env 显式声明'
    );
  }
  return `http://localhost:${process.env.PORT || 3000}`;
}

export function toPublicFileUrl(filePathOrUrl: string | null, req?: AuthRequest): string | null {
  if (!filePathOrUrl) return null;
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;

  // 拒绝任何 protocol-relative URL(`//evil.com/x`)或反斜杠变体,防止被解释为外域
  if (/^\/\/|^\\\\/.test(filePathOrUrl)) {
    logger.warn({ filePathOrUrl }, '[file] toPublicFileUrl 拒绝可疑路径');
    return null;
  }

  const normalizedPath = filePathOrUrl.startsWith('/') ? filePathOrUrl : `/${filePathOrUrl}`;

  // 路径里禁止出现 `..` 段(防 path traversal,虽然这里只是拼成 URL 不会直接读盘,但留着是为了不让数据库被投毒)
  if (normalizedPath.split('/').some(seg => seg === '..')) {
    logger.warn({ normalizedPath }, '[file] toPublicFileUrl 拒绝包含 .. 的路径');
    return null;
  }

  return `${getBaseUrl(req)}${normalizedPath}`;
}

// Upload essay images locally for development and simple deployments.
router.post('/upload', upload.single('file'), async (req: AuthRequest, res: Response) => {
  try {
    if (!req.file) {
      res.status(400).json({ code: 400, message: 'file is required' });
      return;
    }

    const fileUrl = toPublicFileUrl(`/uploads/${req.file.filename}`, req);
    res.json({
      code: 0,
      data: {
        fileName: req.file.originalname,
        fileUrl,
        fileSize: req.file.size
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get files list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { type } = req.query;
    const prisma = getPrisma();

    const where: any = { userId };
    if (type) {
      where.fileType = type;
    }

    const files = await prisma.generatedFile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.json({
      code: 0,
      data: files.map(f => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileUrl: toPublicFileUrl(f.fileUrl, req),
        fileSize: f.fileSize,
        sourceType: f.sourceType,
        sourceId: f.sourceId,
        createdAt: f.createdAt.toISOString()
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get recent files
router.get('/recent', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const files = await prisma.generatedFile.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10
    });

    res.json({
      code: 0,
      data: files.map(f => ({
        id: f.id,
        fileName: f.fileName,
        fileType: f.fileType,
        fileUrl: toPublicFileUrl(f.fileUrl, req),
        createdAt: f.createdAt.toISOString().split('T')[0]
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;

// File upload endpoint (for internal use by other services)
export async function saveFileToLocal(
  fileName: string,
  buffer: Buffer,
  fileType: string = 'docx'
): Promise<string> {
  const timestamp = Date.now();
  const safeName = fileName.replace(/[^a-zA-Z0-9一-龥]/g, '_');
  const filePath = path.join(UPLOAD_DIR, `${timestamp}_${safeName}.${fileType}`);

  fs.writeFileSync(filePath, buffer);

  return toPublicFileUrl(`/uploads/${timestamp}_${safeName}.${fileType}`)!;
}
