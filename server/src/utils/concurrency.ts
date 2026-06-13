// 简单并发限流器(等价 p-limit 但 0 依赖,CJS 友好,不会触发 ERR_REQUIRE_ESM)
// 用法:
//   const limit = createEssayLimiter();
//   await limit(() => doWork());
//
// 设计要点:
// - 全模块共享同一个 limiter 实例,start 跑 X 个 + retry 跑 Y 个时,总并发不会超过 cap
// - 任务 throw 时通过 finally 释放信号量,绝不会泄漏
// - 默认 cap 从 env ESSAY_MAX_CONCURRENT 读(部署在 ecosystem.config.cjs),缺省 3

type Task<T> = () => Promise<T>;

export function createEssayLimiter(maxConcurrent?: number) {
  const cap =
    maxConcurrent ?? parseInt(process.env.ESSAY_MAX_CONCURRENT || '3', 10);
  let active = 0;
  const queue: Array<() => void> = [];

  const tryNext = () => {
    while (active < cap && queue.length > 0) {
      active++;
      const next = queue.shift()!;
      next();
    }
  };

  return function limit<T>(task: Task<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      queue.push(() => {
        task().then(resolve, reject).finally(() => {
          active--;
          tryNext();
        });
      });
      tryNext();
    });
  };
}
