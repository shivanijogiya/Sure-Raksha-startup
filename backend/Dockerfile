# ── Suraksha backend → Cloud Run ──────────────
FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Cloud Run sets PORT (8080); server.js reads it.
USER node
EXPOSE 8080
CMD ["node", "server.js"]
