# 多阶段 build:builder 编译 ts → runtime 装最小依赖 + chromium
# chromium 体积大,但避免运行时 puppeteer.install() 阻塞首次请求

# ============ Stage 1: builder ============
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# 装 build 必需的依赖
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY prisma ./prisma
COPY src ./src

# Prisma generate + tsc 编译
RUN npx prisma generate
RUN npm run build

# ============ Stage 2: runtime ============
FROM node:20-bookworm-slim AS runtime
WORKDIR /app

# Chromium 运行时依赖(headless 也要这些)
# fonts-noto-cjk: 中文字体,PDF 渲染必备
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-noto-cjk \
    fonts-noto-color-emoji \
    ca-certificates \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2 \
 && rm -rf /var/lib/apt/lists/*

# 让 puppeteer 用系统 chromium 而不是再下载一份
ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY prisma ./prisma
COPY src/data ./src/data

# 数据/上传卷
RUN mkdir -p /app/data /app/uploads /app/temp
VOLUME ["/app/data", "/app/uploads"]

ENV NODE_ENV=production
ENV DATABASE_URL=file:/app/data/dev.db
ENV UPLOAD_DIR=/app/uploads
ENV TEMP_DIR=/app/temp
ENV HOST=0.0.0.0
ENV PORT=3000

EXPOSE 3000

# 启动前自动同步 schema(首次启动建表)
CMD ["sh", "-c", "npx prisma db push --skip-generate && node dist/app.js"]
