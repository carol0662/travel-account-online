# 多阶段可省略，直接用官方 Node 22 镜像即可
FROM node:22-slim

WORKDIR /app

# 先装依赖（利用层缓存）
COPY package.json ./
RUN npm install --omit=dev

# 复制源码（node_modules / data 已被 .dockerignore 排除）
COPY . .

# Hugging Face Spaces 会把容器端口通过环境变量 PORT 暴露（默认 7860）
ENV PORT=7860
EXPOSE 7860

# 有 DATABASE_URL 时自动连 Neon/Supabase；没有则本地 SQLite
CMD ["node", "--experimental-sqlite", "server.js"]
