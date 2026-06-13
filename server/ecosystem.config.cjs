// PM2 进程管理配置
// 用法:pm2 delete ai-teacher && pm2 start ecosystem.config.cjs && pm2 save
// 关键配置:
// - max_memory_restart: 800M  —— 超过 800M 自动重启 PM2,保命用(防 1.7G 内存被吃光)
// - ESSAY_MAX_CONCURRENT=3   —— server/src/utils/concurrency.ts 读这个 env 控制批改并发
// - instances: 1 / fork     —— 1.7G 内存不跑 cluster,单进程 + 限流更稳

module.exports = {
  apps: [
    {
      name: 'ai-teacher',
      script: './dist/app.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '800M',
      kill_timeout: 8000,
      listen_timeout: 10000,
      wait_ready: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        ESSAY_MAX_CONCURRENT: '3',
      },
    },
  ],
};
