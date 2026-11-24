# Stage 1: Build React + Vite frontend
FROM node:22-alpine AS web-builder
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm install
COPY web/ ./
RUN npm run build

# Stage 2: Build static Go binary with embedded web UI
FROM golang:1.23-alpine AS go-builder
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/internal/webui/dist ./internal/webui/dist
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /out/orbit ./cmd/orbit

# Stage 3: Minimal runtime image
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai \
    ORBIT_ADDR=:8080 \
    ORBIT_DATA_DIR=/app/data
WORKDIR /app
COPY --from=go-builder /out/orbit /usr/local/bin/orbit
VOLUME ["/app/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/orbit"]
