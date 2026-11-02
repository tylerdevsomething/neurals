# Neurals: one service for the indexer (API at /api, settler) and the website.
#
#   docker build -t neurals .
#   docker run -p 8080:8080 -v neurals-data:/data -e RPC_URL=... -e SETTLER_KEY='[...]' neurals
#
# Secrets come only from the environment: RPC_URL (a private RPC; never shown to browsers) and
# SETTLER_KEY (the settler keypair as its JSON array). INDEXER_CONFIG picks the config file.

# --- build the website ---
FROM node:24-slim AS site
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY brain ./brain
COPY site ./site
RUN npx vite build site

# --- runtime: Node runs the TypeScript directly ---
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY brain ./brain
COPY indexer ./indexer
COPY rules ./rules
COPY deploy ./deploy
COPY --from=site /app/site/dist ./site/dist
ENV NODE_ENV=production STATIC_DIR=/app/site/dist DATA_DIR=/data INDEXER_CONFIG=deploy/indexer.devnet.json
EXPOSE 8080
CMD ["sh", "-c", "exec node indexer/main.ts \"$INDEXER_CONFIG\""]
