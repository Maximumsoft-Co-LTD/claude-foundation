# syntax=docker/dockerfile:1
FROM golang:1.25-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api
RUN GOBIN=/out go install github.com/pressly/goose/v3/cmd/goose@v3.27.1

FROM alpine:3.20
RUN apk add --no-cache ca-certificates && adduser -D -u 10001 app
WORKDIR /app
COPY --from=builder /out/api /usr/local/bin/api
COPY --from=builder /out/goose /usr/local/bin/goose
COPY internal/adapters/driven/postgres/migrations /app/migrations
ENV MIGRATIONS_DIR=/app/migrations
USER app
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
