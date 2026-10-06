# syntax=docker/dockerfile:1
# AdminIA — image de production (indépendante de l'hébergeur).
#   docker build -t adminia .
#   docker run --env-file .env.production -p 3000:3000 adminia
# Migrations (avant chaque mise en production) :
#   docker run --rm --env-file .env.production adminia npm run db:migrate
# Aucun secret n'est intégré à l'image : toute la configuration passe par l'environnement.
# Derrière un proxy d'entreprise : --build-arg HTTPS_PROXY=… --secret id=ca,src=certificat-du-proxy.pem
# (le certificat ne sert qu'à l'installation des paquets et n'est pas copié dans l'image).

FROM node:22-bookworm-slim AS base
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Dépendances complètes pour la construction
FROM base AS deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --no-audit --no-fund

# Construction
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Dépendances de production uniquement (tsx inclus pour les scripts d'exploitation)
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN --mount=type=secret,id=ca,required=false \
    if [ -f /run/secrets/ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/ca; fi; \
    npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# Image finale
FROM base AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
COPY --from=prod-deps --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/.next ./.next
COPY --chown=node:node package.json package-lock.json next.config.ts tsconfig.json ./
COPY --chown=node:node public ./public
COPY --chown=node:node drizzle ./drizzle
COPY --chown=node:node scripts ./scripts
COPY --chown=node:node evals ./evals
COPY --chown=node:node src ./src
# Stockage local (instance unique) : à monter sur un volume persistant, ou utiliser STORAGE_DRIVER=s3.
RUN mkdir -p /app/.data && chown node:node /app/.data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node_modules/.bin/next", "start"]
