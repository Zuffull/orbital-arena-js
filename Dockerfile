FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json client/package.json
COPY server/package.json server/package.json
COPY shared/package.json shared/package.json
RUN npm ci --no-audit --no-fund
COPY client ./client
COPY shared ./shared
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:24-alpine
ARG BUILD_SHA
LABEL org.opencontainers.image.source="https://github.com/Zuffull/orbital-arena-js" \
      org.opencontainers.image.revision=$BUILD_SHA
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 BUILD_SHA=$BUILD_SHA LOG_DIR=/app/logs
WORKDIR /app
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/package.json ./package.json
COPY --from=build --chown=node:node /app/client/dist ./client/dist
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
RUN mkdir /app/logs && chown node:node /app/logs
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"]
CMD ["node", "server/index.ts"]
