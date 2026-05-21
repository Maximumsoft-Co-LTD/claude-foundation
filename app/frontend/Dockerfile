# syntax=docker/dockerfile:1
FROM node:22-alpine AS builder
WORKDIR /src
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S app && adduser -S -G app -u 10001 app
COPY --from=builder --chown=app:app /src/package.json /src/package-lock.json* ./
COPY --from=builder --chown=app:app /src/.next ./.next
COPY --from=builder --chown=app:app /src/public ./public
COPY --from=builder --chown=app:app /src/node_modules ./node_modules
COPY --from=builder --chown=app:app /src/next.config.js ./next.config.js
USER app
EXPOSE 3000
CMD ["npm", "start"]
