# syntax=docker/dockerfile:1

# ==========================================================
# Packet Tools - Imagen todo-en-uno (backend + frontend)
# El backend (Express + Socket.IO, :7531) y el frontend
# (Next.js, :3090) se ejecutan dentro del mismo contenedor.
# ==========================================================

# ---- Etapa de dependencias ----
FROM node:24-bookworm-slim AS deps
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Herramientas para compilar módulos nativos (better-sqlite3, serialport) si no hay prebuilds
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci

# ---- Etapa de compilación ----
FROM deps AS builder
WORKDIR /app
COPY . .
# Prisma necesita DATABASE_URL para generar el cliente
ENV DATABASE_URL=file:.packet_tool_database.db
RUN npm run generate --workspace=@packet-tools/server
RUN npm run build --workspace=@packet-tools/server
# Variables públicas del frontend (se inlinean en build)
ARG NEXT_PUBLIC_API_URL=http://localhost:7531
ARG NEXT_PUBLIC_COOKIE_NAME=packet-tools-cookie
ARG NEXT_PUBLIC_PROYECT_NAME="Packet Tools"
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_BACKEND_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_COOKIE_NAME=$NEXT_PUBLIC_COOKIE_NAME \
    NEXT_PUBLIC_PROYECT_NAME=$NEXT_PUBLIC_PROYECT_NAME \
    NODE_ENV=production
RUN npm run build --workspace=@packet-tools/web

# ---- Etapa final ----
FROM node:22-bookworm-slim AS runner
WORKDIR /app
# libudev1: requerido por los bindings nativos de serialport en Linux
RUN apt-get update && apt-get install -y --no-install-recommends \
    libudev1 ca-certificates \
    && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    SERVER_PORT=7531 \
    PORT=3090 \
    DATABASE_URL=file:/app/data/packet_tools.db \
    NEXT_PUBLIC_API_URL=http://localhost:7531 \
    NEXT_PUBLIC_COOKIE_NAME=packet-tools-cookie \
    NEXT_PUBLIC_PROYECT_NAME="Packet Tools" \
    NEXT_TELEMETRY_DISABLED=1
COPY --from=builder /app ./
RUN mkdir -p /app/data
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 7531 3090
ENTRYPOINT ["docker-entrypoint.sh"]
