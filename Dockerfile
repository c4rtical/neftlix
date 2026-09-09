# Build the web app, then run the server with the built assets.
FROM node:23-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:23-alpine
ENV NODE_ENV=production \
    PORT=8787 \
    NEFTLIX_DATA=/data
WORKDIR /app
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci --omit=dev --workspace=server && npm cache clean --force
COPY server/src server/src
COPY --from=build /app/web/dist web/dist
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
EXPOSE 8787
USER node
CMD ["node", "--no-warnings=ExperimentalWarning", "server/src/index.ts"]
