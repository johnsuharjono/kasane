.DEFAULT_GOAL := help
COMPOSE := docker compose -f dev/db/compose.yaml
.PHONY: help setup db-up db-down db-seed db-verify db-reset db-destroy db-shell
help:
	@echo 'setup       Install pinned dependencies with Bun'
	@echo 'db-up       Start isolated PostgreSQL on localhost:55432'
	@echo 'db-seed     Recreate fixture schemas and insert deterministic data'
	@echo 'db-verify   Verify data, types, relationships and indexes'
	@echo 'db-reset    Destroy, recreate, seed and verify Kasane database'
	@echo 'db-down     Stop database; retain data'
	@echo 'db-destroy  Delete Kasane container and database volume'
	@echo 'db-shell    Open psql in Kasane database'
	@echo 'db-multi-up Start both isolated demo databases'
	@echo 'db-seed-analytics Seed and verify the second demo database'
	@echo 'db-multi-check Verify switching between both databases'
	@echo 'db-multi-reset Destroy and reseed both demo databases'
	@echo 'dev         Launch native development app'
	@echo 'build       Package a macOS development app'
	@echo 'check       Run frontend, Rust and integration checks'
setup:
	bun install --frozen-lockfile
db-up:
	$(COMPOSE) up -d --wait
db-down:
	$(COMPOSE) --profile multi down
db-seed:
	bun run db:seed
db-verify:
	bun run db:verify
db-reset:
	$(MAKE) db-destroy
	$(MAKE) db-up
	$(MAKE) db-seed
	$(MAKE) db-verify
db-destroy:
	$(COMPOSE) --profile multi down --volumes --remove-orphans
db-shell:
	$(COMPOSE) exec postgres psql -U kasane -d kasane_dev

.PHONY: dev build check
dev:
	bun run tauri dev
build:
	bun run tauri build --debug --bundles app
check:
	bun run build
	cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
	cargo test --manifest-path src-tauri/Cargo.toml -- --include-ignored
	bun run test

.PHONY: db-multi-up db-seed-analytics db-multi-check
db-multi-up:
	$(COMPOSE) --profile multi up -d --wait
db-seed-analytics:
	node dev/db/seed-analytics.mjs
db-multi-check:
	KASANE_MULTI_TEST=1 bun run playwright test tests/multi-connection.spec.mjs

.PHONY: db-multi-reset
db-multi-reset:
	$(MAKE) db-destroy
	$(MAKE) db-multi-up
	$(MAKE) db-seed
	$(MAKE) db-seed-analytics
	$(MAKE) db-verify
