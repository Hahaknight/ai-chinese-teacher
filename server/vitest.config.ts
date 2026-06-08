import { defineConfig } from 'vitest/config';

// 单元测试配置:不依赖数据库/网络
// pool=forks 让 vitest 启子进程跑,避免 puppeteer / prisma 这种带原生模块的 import 卡住主进程
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    testTimeout: 15000,
    hookTimeout: 15000,
    // 显式排除 e2e / integration,这些需要起 server
    exclude: ['node_modules/**', 'dist/**']
  }
});
