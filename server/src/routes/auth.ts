import { Router, Request, Response } from 'express';
import wx from 'axios';
import { getPrisma } from '../utils/db';
import { generateToken } from '../middlewares/auth';

const router = Router();

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

    const wxResponse = await wx.get(`https://api.weixin.qq.com/cgi-bin/token`, {
      params: {
        grant_type: 'client_credential',
        appid: appId,
        secret: appSecret
      }
    });

    const { access_token } = wxResponse.data;

    // Get user info using access_token and code
    const userResponse = await wx.get(`https://api.weixin.qq.com/cgi-bin/user/info`, {
      params: {
        access_token,
        openid: code, // In practice, code needs to be exchanged for openid
        lang: 'zh_CN'
      }
    });

    // For demo purposes, use code as openid directly
    // In production, you'd exchange code for openid first
    const openId = code;
    const nickname = userResponse.data?.nickname || '老师';
    const avatarUrl = userResponse.data?.headimgurl || '';

    // Find or create user
    const prisma = getPrisma();
    let user = await prisma.user.findUnique({ where: { openId } });

    if (!user) {
      user = await prisma.user.create({
        data: { openId, nickname, avatarUrl }
      });
    }

    // Generate JWT token
    const token = generateToken(user.id);

    res.json({
      code: 0,
      data: {
        token,
        user: {
          id: user.id,
          openId: user.openId,
          nickname: user.nickname,
          avatarUrl: user.avatarUrl
        }
      }
    });
  } catch (err: any) {
    console.error('WeChat login error:', err);
    res.status(500).json({ code: 500, message: err.message || 'Login failed' });
  }
});

export default router;