# syntax=docker/dockerfile:1

# --- build stage ---
FROM node:20-slim AS build

WORKDIR /app

# Install dependencies (clean, reproducible)
COPY package*.json ./
RUN npm ci

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# --- runtime stage ---
FROM node:20-slim

WORKDIR /app
ENV NODE_ENV=production

# App files
COPY package*.json ./
COPY --from=build /app/dist ./dist

# Install only prod dependencies
RUN npm ci --omit=dev

# Non-root user for safety
USER node

CMD ["node", "dist/index.js"]
