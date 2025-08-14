# ---- deps (installs devDeps for build) ----
FROM node:24-bookworm AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# ---- build (uses devDeps) ----
FROM node:24-bookworm AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- runtime (lean, prod deps only) ----
FROM node:24-bookworm AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
RUN npx playwright install --with-deps
COPY --from=build /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/index.js"]
