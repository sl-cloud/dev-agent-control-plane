.PHONY: up up-shared down logs test test-unit test-integration reset migrate lint format typecheck

up:
	docker compose up -d --wait

up-shared:
	docker compose -f docker-compose.yml -f docker-compose.shared-net.yml up -d --wait

down:
	docker compose down

logs:
	docker compose logs -f

test:
	docker compose exec api npm test

test-unit:
	docker compose exec api npm run test:unit

test-integration:
	docker compose exec api npm run test:integration

migrate:
	docker compose exec api npm run migrate

lint:
	docker compose exec api npm run lint

format:
	docker compose exec api npm run format

typecheck:
	docker compose exec api npm run typecheck

reset:
	docker compose down -v
	docker compose up -d --wait
