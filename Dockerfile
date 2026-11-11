# Multi-stage build
# mihomo 内核：v1.19.0 不支持 REALITY 的后量子混合密钥（X25519MLKEM768），
# 连 Xray 25.x+ 的服务端会一直 REALITY authentication failed。
# 直接取官方镜像里的二进制，比在构建时 curl GitHub 稳（国内经常 37MB 拉不动）。
FROM metacubex/mihomo:v1.19.34 AS mihomo-bin

FROM node:20-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Runtime Stage (Debian Bookworm slim with native glibc, fully compatible with Mihomo Linux binaries)
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3580

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates tzdata gzip bash \
    && rm -rf /var/lib/apt/lists/*

# Mihomo 内核：直接从官方镜像拷二进制（v1.19.34，支持 REALITY X25519MLKEM768）
# 官方镜像同时提供 amd64 / arm64 版本，构建时按目标架构由 Docker 自动选择
COPY --from=mihomo-bin /mihomo /usr/local/bin/mihomo
RUN chmod 755 /usr/local/bin/mihomo && \
    cp /usr/local/bin/mihomo /app/mihomo && \
    chmod 755 /app/mihomo && \
    /usr/local/bin/mihomo -v

COPY package*.json ./
RUN npm install --omit=dev

# Copy built frontend & backend files
COPY --from=builder /app/dist ./dist
COPY backend ./backend

EXPOSE 3580

VOLUME ["/app/data"]

CMD ["node", "backend/server.js"]
