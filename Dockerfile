# ---------- 依赖层：只在 package*.json 变化时重装 ----------
FROM node:22-alpine AS deps
WORKDIR /app
COPY package*.json ./
# 有 lockfile 就用 ci，保证和开发机一致；没有则退回 install
RUN npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund

# ---------- 运行层 ----------
FROM node:22-alpine
WORKDIR /app

# HOST 必须是 0.0.0.0，否则容器外（包括 -p 端口映射）访问不到
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN mkdir -p /app/data
VOLUME ["/app/data"]
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
