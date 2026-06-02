import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import fs from 'fs';
import path from 'path';
import multer from 'multer';

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

function getBaseUrl(req?: AuthRequest): string {
  const configured = process.env.PUBLIC_BASE_URL || process.env.SERVER_PUBLIC_URL;
  if (configured) {
    return configured.replace(/\/api$/, '').replace(/\/$/, '');
  }

  if (req) {
    const forwardedProto = req.headers['x-forwarded-proto'];
    const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || req.protocol;
    return `${proto}://${req.get('host')}`;
  }

  return `http://localhost:${process.env.PORT || 3000}`;
}

export function toPublicFileUrl(filePathOrUrl: string | null, req?: AuthRequest): string | null {
  if (!filePathOrUrl) return null;
  if (/^https?:\/\//i.test(filePathOrUrl)) return filePathOrUrl;
  const normalizedPath = filePathOrUrl.startsWith('/') ? filePathOrUrl : `/${filePathOrUrl}`;
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
