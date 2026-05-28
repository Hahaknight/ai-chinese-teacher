import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';

const router = Router();
router.use(authMiddleware);

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
        fileUrl: f.fileUrl,
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
        fileUrl: f.fileUrl,
        createdAt: f.createdAt.toISOString().split('T')[0]
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

export default router;