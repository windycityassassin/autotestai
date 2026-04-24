#!/usr/bin/env bash
set -euo pipefail

echo "[setup-goose] Installing Goose CLI..."

if command -v goose &>/dev/null; then
  echo "[setup-goose] Goose already installed: $(goose --version 2>/dev/null || echo 'unknown version')"
else
  if command -v pip3 &>/dev/null; then
    pip3 install goose-ai --quiet && echo "[setup-goose] Installed via pip3"
  elif command -v curl &>/dev/null; then
    curl -fsSL https://github.com/block/goose/releases/latest/download/goose-linux-amd64.tar.gz | tar xz -C /usr/local/bin/ 2>/dev/null \
      && chmod +x /usr/local/bin/goose \
      && echo "[setup-goose] Installed via curl" \
      || echo "[setup-goose] WARNING: Could not install Goose binary — deep heal will use fallback mode"
  else
    echo "[setup-goose] WARNING: Could not install Goose — deep heal will use fallback mode"
    exit 0
  fi
fi

if [ -n "${AI_INTEGRATIONS_ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_KEY="$AI_INTEGRATIONS_ANTHROPIC_API_KEY"
elif [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  ANTHROPIC_KEY="$ANTHROPIC_API_KEY"
else
  echo "[setup-goose] WARNING: No Anthropic API key found — Goose will not function"
  exit 0
fi

GOOSE_CONFIG_DIR="${HOME}/.config/goose"
mkdir -p "$GOOSE_CONFIG_DIR"

cat > "$GOOSE_CONFIG_DIR/config.yaml" <<EOF
provider: anthropic
model: claude-sonnet-4-5
api_key: "${ANTHROPIC_KEY}"
EOF

echo "[setup-goose] Goose configured with Anthropic provider"
echo "[setup-goose] Setup complete"
