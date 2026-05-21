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
COPY --from=builder /src/package.json /src/package-lock.json* ./
COPY --from=builder /src/.next ./.next
COPY --from=builder /src/public ./public
COPY --from=builder /src/node_modules ./node_modules
COPY --from=builder /src/next.config.js ./next.config.js
EXPOSE 3000
CMD ["npm", "start"]
