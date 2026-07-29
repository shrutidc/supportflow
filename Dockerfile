# SupportFlow — Express API only.
# The Next.js frontend is a separate deployment (Vercel); since Phase 3 this
# image serves no HTML.
FROM node:22-slim AS base

WORKDIR /app

# Install production dependencies first for layer caching.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# App source. data.js at the repo root is included deliberately: the seed
# script reads the demo dataset from it (server/src/db/seed.js).
COPY . .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

# NODE_ENV=production requires MONGODB_URI, and every environment except
# test requires CLERK_SECRET_KEY. Both are validated at boot.
CMD ["node", "server/server.js"]
