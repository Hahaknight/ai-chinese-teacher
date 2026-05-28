import { Router, Response } from 'express';
import { getPrisma } from '../utils/db';
import { authMiddleware, AuthRequest } from '../middlewares/auth';
import materialsData from '../data/materials.json';

const router = Router();
router.use(authMiddleware);

// Get materials list
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const { keyword, category } = req.query;
    const prisma = getPrisma();

    // Check if materials exist in DB, if not seed them
    const count = await prisma.writingMaterial.count();
    if (count === 0) {
      await seedMaterials();
    }

    // Build query conditions
    const where: any = {};
    if (category && category !== '全部') {
      where.category = category;
    }

    let materials = await prisma.writingMaterial.findMany({
      where,
      orderBy: { createdAt: 'asc' }
    });

    // Filter by keyword if provided
    if (keyword) {
      const kw = keyword as string;
      materials = materials.filter(m =>
        m.title.includes(kw) ||
        m.tags.includes(kw) ||
        m.suitableThemes.includes(kw)
      );
    }

    res.json({
      code: 0,
      data: materials.map(m => ({
        id: m.id,
        title: m.title,
        category: m.category,
        tags: JSON.parse(m.tags),
        sampleParagraph: m.sampleParagraph
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get material detail
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    const material = await prisma.writingMaterial.findUnique({
      where: { id }
    });

    if (!material) {
      res.status(404).json({ code: 404, message: 'Material not found' });
      return;
    }

    // Check if favorited
    const favorite = await prisma.materialFavorite.findUnique({
      where: {
        userId_materialId: { userId, materialId: id }
      }
    });

    res.json({
      code: 0,
      data: {
        id: material.id,
        title: material.title,
        category: material.category,
        tags: JSON.parse(material.tags),
        coreFeature: material.coreFeature,
        symbolicMeaning: material.symbolicMeaning,
        suitableThemes: material.suitableThemes,
        usageAngle: material.usageAngle,
        sampleParagraph: material.sampleParagraph,
        suitableTopics: JSON.parse(material.suitableTopics),
        warning: material.warning,
        isFavorited: !!favorite
      }
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Toggle favorite
router.post('/:id/favorite', async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const prisma = getPrisma();

    // Check if material exists
    const material = await prisma.writingMaterial.findUnique({ where: { id } });
    if (!material) {
      res.status(404).json({ code: 404, message: 'Material not found' });
      return;
    }

    // Check existing favorite
    const existing = await prisma.materialFavorite.findUnique({
      where: { userId_materialId: { userId, materialId: id } }
    });

    if (existing) {
      // Remove favorite
      await prisma.materialFavorite.delete({
        where: { id: existing.id }
      });
      res.json({ code: 0, data: { isFavorited: false } });
    } else {
      // Add favorite
      await prisma.materialFavorite.create({
        data: { userId, materialId: id }
      });
      res.json({ code: 0, data: { isFavorited: true } });
    }
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get favorites list
router.get('/favorites/list', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.userId!;
    const prisma = getPrisma();

    const favorites = await prisma.materialFavorite.findMany({
      where: { userId },
      include: { material: true },
      orderBy: { createdAt: 'desc' }
    });

    res.json({
      code: 0,
      data: favorites.map(f => ({
        id: f.material.id,
        title: f.material.title,
        category: f.material.category,
        tags: JSON.parse(f.material.tags),
        sampleParagraph: f.material.sampleParagraph
      }))
    });
  } catch (err: any) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Seed materials from JSON
async function seedMaterials() {
  const prisma = getPrisma();
  const materials = materialsData as any[];

  for (const m of materials) {
    await prisma.writingMaterial.create({
      data: {
        title: m.title,
        category: m.category,
        tags: JSON.stringify(m.tags || []),
        coreFeature: m.coreFeature,
        symbolicMeaning: m.symbolicMeaning,
        suitableThemes: m.suitableThemes,
        usageAngle: m.usageAngle,
        sampleParagraph: m.sampleParagraph,
        suitableTopics: JSON.stringify(m.suitableTopics || []),
        warning: m.warning || ''
      }
    });
  }

  console.log(`Seeded ${materials.length} materials`);
}

export default router;