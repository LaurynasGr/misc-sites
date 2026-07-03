.PHONY:
help:
	@echo Tasks:
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z_-]+:.*?## / {printf "\033[36m%-30s\033[0m %s\n", $$1, $$2}' $(MAKEFILE_LIST)

dev: ## Run development server (watch + live reload)
	bun run dev

start: ## Serve dist/ with Bun (production)
	bun run start

lint: ## Run linter
	bun run lint

lint-fix: ## Run linter and fix issues
	bun run lint:fix

# Cleanup
clean: ## Remove all generated files
	rm -rf node_modules && \
		bun install
