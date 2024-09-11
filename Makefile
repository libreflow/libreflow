# Run all three processes in parallel
MAKEFLAGS += -j3
dev: docker bun-dev prisma-studio

docker:
	docker compose up

bun-dev:
	bun run dev

prisma-studio:
	bunx prisma studio