# Stage 1: Build React + Vite frontend
FROM --platform=$BUILDPLATFORM node:24-alpine AS web-builder
WORKDIR /src/web
COPY web/package.json web/package-lock.json* ./
RUN npm ci || npm install
COPY web/ ./
RUN npm run build

# Stage 2: Build static Go binary with embedded web UI
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS go-builder
ARG TARGETOS
ARG TARGETARCH
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=web-builder /src/internal/webui/dist ./internal/webui/dist
RUN CGO_ENABLED=0 GOOS=${TARGETOS:-linux} GOARCH=${TARGETARCH} go build -ldflags="-s -w" -o /out/orbit ./cmd/orbit

# Stage 3: Minimal runtime image
FROM alpine:3.24
RUN apk add --no-cache ca-certificates tzdata
ENV TZ=Asia/Shanghai \
    ORBIT_ADDR=:8080 \
    ORBIT_DATA_DIR=/app/data
WORKDIR /app
COPY --from=go-builder /out/orbit /usr/local/bin/orbit
VOLUME ["/app/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/orbit"]
