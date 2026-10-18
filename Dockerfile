# Servidor do Discordia + versão web do app, numa imagem só.
#
#   docker build -t discordia .
#   docker run -p 8787:8787 discordia
#
# Depois é só apontar o app pra ws://SEU_IP:8787 (ou wss://seu.dominio
# atrás de um proxy com HTTPS). Abrir http://SEU_IP:8787 no navegador também
# entra na sala, sem instalar nada.

# ---- 1. Build da interface web ----
FROM node:22-slim AS web
WORKDIR /app
# O build web não precisa do binário do Electron (~100 MB).
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY app/package.json app/package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY app/ ./
ARG VITE_DEFAULT_SERVER=
ENV VITE_DEFAULT_SERVER=${VITE_DEFAULT_SERVER}
RUN npx vite build

# ---- 2. Servidor ----
FROM node:22-slim
WORKDIR /srv
ENV NODE_ENV=production \
    PORT=8787 \
    WEB_DIR=/srv/public
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY server/*.js ./
COPY --from=web /app/dist ./public
EXPOSE 8787
USER node
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "index.js"]
