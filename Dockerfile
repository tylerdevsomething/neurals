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
# The v2 site (site-v2/) and its 3D pages (hero-lab/), served together: the 3D pages under /lab/.
COPY site-v2 ./site-v2
COPY hero-lab ./hero-lab
COPY deploy/vite.hero-lab.ts ./deploy/vite.hero-lab.ts
RUN cd hero-lab && npm ci --no-audit --no-fund
RUN VITE_THEME=white VITE_LAB_URL=/lab npx vite build site-v2 \
 && npx vite build --config deploy/vite.hero-lab.ts --outDir ../site-v2/dist/lab

# --- runtime: Node runs the TypeScript directly ---
FROM node:24-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY brain ./brain
COPY indexer ./indexer
COPY rules ./rules
COPY deploy ./deploy
COPY --from=site /app/site-v2/dist ./site/dist
ENV NODE_ENV=production STATIC_DIR=/app/site/dist DATA_DIR=/data INDEXER_CONFIG=deploy/indexer.devnet.json
EXPOSE 8080
CMD ["sh", "-c", "exec node indexer/main.ts \"$INDEXER_CONFIG\""]
