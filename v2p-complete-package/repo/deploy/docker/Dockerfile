# =============================================================================
# Production Dockerfile — target state for hardened vibe-coded apps
#
# Multi-stage build. Non-root user. Health check. Minimal attack surface.
# Drop this into any hardened project and adjust the build commands.
# =============================================================================

# --- Stage 1: Dependencies ---
FROM node:22-alpine AS deps
WORKDIR /app

# Install only production deps first (cache layer)
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev && npm cache clean --force

# --- Stage 2: Build ---
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src/ ./src/

RUN npm run build

# --- Stage 3: Production ---
FROM node:22-alpine AS production

# Security: non-root user
RUN addgroup -g 1001 appgroup && \
    adduser -u 1001 -G appgroup -s /bin/sh -D appuser

WORKDIR /app

# Copy only what's needed
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# No secrets in image — all via env vars at runtime
ENV NODE_ENV=production
ENV PORT=3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/health || exit 1

# Non-root
USER appuser

EXPOSE 3000

CMD ["node", "dist/index.js"]
