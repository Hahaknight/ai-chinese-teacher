// 请求级中间件:给每个请求生成 reqId,加到响应头 + req 对象上
// 后续 service 想拿 reqId 可以从 req.reqId 取(目前只在 access log 用)
//
// reqId 优先取上游 X-Request-Id 头(网关已经生成),没有时本地 crypto.randomUUID 兜底

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { logger } from '../utils/logger';

export interface RequestWithId extends Request {
  reqId?: string;
}

export function requestIdMiddleware(req: RequestWithId, res: Response, next: NextFunction): void {
  const upstreamId = req.headers['x-request-id'];
  const reqId = (Array.isArray(upstreamId) ? upstreamId[0] : upstreamId) || crypto.randomUUID();
  req.reqId = reqId;
  res.setHeader('X-Request-Id', reqId);

  const t0 = Date.now();
  res.on('finish', () => {
    logger.info(
      {
        reqId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration: Date.now() - t0
      },
      `${req.method} ${req.path} ${res.statusCode} ${Date.now() - t0}ms`
    );
  });

  next();
}
