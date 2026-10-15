FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
COPY client/package.json client/
COPY server/package.json server/
RUN npm ci --workspaces --include-workspace-root=false
COPY client client
RUN npm -w client run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production TZ=Asia/Jakarta
COPY package*.json ./
COPY server/package.json server/
RUN npm ci -w server --omit=dev --include-workspace-root=false
COPY server server
COPY --from=build /app/client/dist client/dist
CMD ["node", "server/index.js"]
