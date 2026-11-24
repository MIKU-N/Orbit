.PHONY: dev-web clean-artifacts build-web build test run clean docker

dev-web:
	cd web && npm run dev

clean-artifacts:
	rm -rf internal/webui/dist web/dist bin/orbit
	mkdir -p internal/webui/dist && touch internal/webui/dist/.gitkeep

build-web:
	rm -rf internal/webui/dist web/dist
	cd web && npm install && npm run build
	mkdir -p internal/webui/dist && touch internal/webui/dist/.gitkeep

build: build-web
	rm -f bin/orbit
	CGO_ENABLED=0 go build -ldflags="-s -w" -o bin/orbit ./cmd/orbit

test:
	go test -v ./...

run: build
	./bin/orbit

clean:
	rm -rf bin internal/webui/dist web/dist data
	mkdir -p internal/webui/dist && touch internal/webui/dist/.gitkeep

docker:
	docker compose up -d --build
