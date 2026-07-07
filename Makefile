# repo-launcher — dev tooling for Linux / WSL / macOS.
# Bare `make` prints help. On Windows, use mise instead (see README / mise.toml).

SHELL := /bin/bash
.DEFAULT_GOAL := help

APT_DEPS := libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev \
            libssl-dev libayatana-appindicator3-dev librsvg2-dev pkg-config

.PHONY: help doctor setup install dev run build bundle preview test fmt clean clean-all

help: ## Show this help
	@awk 'BEGIN {FS = ":.*##"; printf "\nrepo-launcher — make <target>\n\n"} \
		/^[a-zA-Z0-9_-]+:.*##/ { printf "  \033[36m%-11s\033[0m %s\n", $$1, $$2 }' $(MAKEFILE_LIST)
	@printf '\nWindows: use mise (mise install; mise run dev|bundle) — see README.\n\n'

doctor: ## Check prerequisites (no install, no sudo)
	@printf '== repo-launcher doctor ==\n'
	@if command -v node  >/dev/null 2>&1; then printf '[ok]      node %s\n'  "$$(node -v)";        else printf '[MISSING] node  -> install Node LTS (mise install, or your package manager)\n'; fi
	@if command -v npm   >/dev/null 2>&1; then printf '[ok]      npm %s\n'   "$$(npm -v)";         else printf '[MISSING] npm   -> ships with Node\n'; fi
	@if command -v cargo >/dev/null 2>&1; then printf '[ok]      %s\n'       "$$(cargo --version)"; else printf "[MISSING] cargo -> curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y\n"; fi
	@if command -v pkg-config >/dev/null 2>&1; then printf '[ok]      pkg-config\n'; else printf '[MISSING] pkg-config -> run: make setup\n'; fi
	@if pkg-config --exists webkit2gtk-4.1 2>/dev/null; then printf '[ok]      libwebkit2gtk-4.1\n'; else printf '[MISSING] libwebkit2gtk-4.1-dev -> run: make setup\n'; fi
	@if pkg-config --exists gtk+-3.0        2>/dev/null; then printf '[ok]      gtk+-3.0\n';        else printf '[MISSING] libgtk-3-dev -> run: make setup\n'; fi
	@if [[ -f "$$HOME/.cache/goto-repo/repos.tsv" ]]; then printf '[ok]      goto-repo cache present\n'; else printf '[warn]    goto-repo cache missing (~/.cache/goto-repo/repos.tsv) — the app reads repos from goto-repo/shell-finders\n'; fi

setup: ## Install ALL deps: system libs (sudo apt), Rust (rustup), npm packages
	@set -e; \
	if command -v apt-get >/dev/null 2>&1; then \
		echo '-> Installing Tauri system dependencies (sudo apt-get)'; \
		sudo apt-get update; \
		sudo apt-get install -y $(APT_DEPS); \
	else \
		echo '-> Non-apt system detected: install the Tauri system libs manually (see: make doctor)'; \
	fi; \
	if ! command -v cargo >/dev/null 2>&1; then \
		echo '-> Installing Rust via rustup'; \
		curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y; \
		echo '-> cargo installed — run `source "$$HOME/.cargo/env"` or open a new shell to pick it up'; \
	else \
		echo "-> Rust present: $$(cargo --version)"; \
	fi; \
	echo '-> Installing JS dependencies (npm install)'; \
	npm install
	@echo '-> Setup complete. Run: make dev'

install: ## Install JS dependencies only (npm install)
	npm install

dev: ## Run the app in dev mode (tauri dev)
	npm run tauri dev

run: dev ## Alias for `make dev`

build: ## Typecheck + build the frontend (tsc + vite build)
	npm run build

bundle: ## Build the native app + installers (tauri build; Windows installers via mise on Windows)
	npm run tauri build

preview: ## Serve the built frontend (vite preview)
	npm run preview

test: ## Run Rust unit tests — cache parsing + ranking (cargo test --lib)
	cd src-tauri && cargo test --lib

fmt: ## Format Rust code (cargo fmt)
	cd src-tauri && cargo fmt

clean: ## Remove build outputs (dist/, src-tauri/target/)
	rm -rf dist src-tauri/target

clean-all: clean ## Also remove node_modules/
	rm -rf node_modules
