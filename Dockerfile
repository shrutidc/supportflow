# SupportFlow — Express API + static frontend
FROM node:22-slim AS base

WORKDIR /app

# Install production dependencies first for layer caching.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# App source: the API serves the static frontend from the repo root.
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# NODE_ENV=production requires MONGODB_URI (validated at boot).
CMD ["node", "server/server.js"]
