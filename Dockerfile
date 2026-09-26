FROM node:24 AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build \
    && cp -r src/db/migrations dist/db/migrations \
    && npm prune --omit=dev

FROM node:24-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 nodejs \
    && useradd --system --uid 1001 --gid nodejs nodeuser
COPY --from=builder --chown=nodeuser:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodeuser:nodejs /app/dist ./dist
COPY --chown=nodeuser:nodejs package.json ./
USER nodeuser
CMD ["node", "dist/index.js"]
