import { Router, Request, Response } from 'express';
import wechatApi from 'axios';
import { getPrisma } from '../utils/db';
import { generateToken } from '../middlewares/auth';

const router = Router();

async function issueToken(openId: string, nickname = '老师', avatarUrl = '', unionId?: string) {
  const prisma = getPrisma();
  let user = await prisma.user.findUnique({ where: { openId } });

  if (!user) {
    user = await prisma.user.create({
      data: { openId, unionId, nickname, avatarUrl }
    });
  } else {
    user = await prisma.user.update({
      where: { id: user.id },
      data: { unionId: unionId || user.unionId, nickname, avatarUrl }
    });
  }

  return {
    token: generateToken(user.id),
    user: {
      id: user.id,
      openId: user.openId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl
    }
  };
}

// WeChat login
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { code } = req.body;

    if (!code) {
      res.status(400).json({ code: 400, message: 'Code is required' });
      return;
    }

    // Get openid from WeChat
    const appId = process.env.WECHAT_APP_ID;
    const appSecret = process.env.WECHAT_APP_SECRET;

    if (!appId || !appSecret || appId.startsWith('your_') || appSecret.startsWith('your_')) {
      res.status(400).json({ code: 400, message: 'WECHAT_APP_ID and WECHAT_APP_SECRET are not configured' });
      return;
    }

    const wxResponse = await wechatApi.get('https://api.weixin.qq.com/sns/jscode2session', {
      params: {
        appid: appId,
        secret: appSecret,
        js_code: code,
        grant_type: 'authorization_code'
      }
    });

    if (wxResponse.data.errcode) {
      res.status(400).json({ code: 400, message: wxResponse.data.errmsg || 'Wechat login failed' });
      return;
    }

    const result = await issueToken(wxResponse.data.openid, '老师', '', wxResponse.data.unionid);

    res.json({ code: 0, data: result });
  } catch (err: any) {
    console.error('WeChat login error:', err);
    res.status(500).json({ code: 500, message: err.message || 'Login failed' });
  }
});

// Development-only login for local API tests without a WeChat code.
router.post('/dev-login', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(404).json({ code: 404, message: 'Not found' });
    return;
  }

  const openId = req.body?.openId || 'dev-openid';
  const nickname = req.body?.nickname || '本地测试老师';
  const result = await issueToken(openId, nickname);
  res.json({ code: 0, data: result });
});

export default router;
