#!/bin/bash

# Exit on any error
set -e

STELLAR_CLI="${STELLAR_CLI:-stellar}"
CARGO_TOOLCHAIN_ARGS=()
if [ -n "${CARGO_TOOLCHAIN:-}" ]; then
  CARGO_TOOLCHAIN_ARGS=("+${CARGO_TOOLCHAIN}")
elif [ "${OS:-}" = "Windows_NT" ] && command -v rustup >/dev/null 2>&1 && rustup toolchain list | grep -q '^stable-x86_64-pc-windows-gnu'; then
  CARGO_TOOLCHAIN_ARGS=("+stable-x86_64-pc-windows-gnu")
fi

echo "======================================================="
echo "Deploying Soroban NFT Ticketing Contracts to Testnet"
echo "======================================================="

# ── Required environment variables ────────────────────────────────────────────
# XLM_TESTNET_TOKEN — The Stellar Asset Contract address for native XLM on testnet.
# Testnet default: CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC
# Set this in your shell before running: export XLM_TESTNET_TOKEN=<address>
# Never hardcode it here — see AGENTS.md hard rules.
if [ -z "${XLM_TESTNET_TOKEN}" ]; then
  echo "❌ ERROR: XLM_TESTNET_TOKEN environment variable is not set."
  echo "   Export it before running this script:"
  echo "   export XLM_TESTNET_TOKEN=CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"
  exit 1
fi

# Verify organizer exists before proceeding
if ! "$STELLAR_CLI" keys ls | grep -q "\borganizer\b"; then
    echo "❌ ERROR: 'organizer' identity not found."
    echo "Run 'bash scripts/fund.sh' first to generate and fund the deployment account."
    exit 1
fi

echo "1. Compiling WASM binaries..."
cd contracts
cargo "${CARGO_TOOLCHAIN_ARGS[@]}" build --target wasm32v1-none --release
cd ..

echo ""
echo "2. Regenerating TypeScript bindings from these exact WASM artifacts..."
"$STELLAR_CLI" contract bindings typescript \
  --wasm contracts/target/wasm32v1-none/release/ticket.wasm \
  --output-dir frontend/src/contracts/ticket \
  --overwrite
"$STELLAR_CLI" contract bindings typescript \
  --wasm contracts/target/wasm32v1-none/release/marketplace.wasm \
  --output-dir frontend/src/contracts/marketplace \
  --overwrite
npm install --prefix frontend/src/contracts/ticket --no-package-lock
npm run build --prefix frontend/src/contracts/ticket
npm install --prefix frontend/src/contracts/marketplace --no-package-lock
npm run build --prefix frontend/src/contracts/marketplace

echo ""
echo "3. Deploying TicketContract..."
TICKET_ID=$("$STELLAR_CLI" contract deploy \
  --wasm contracts/target/wasm32v1-none/release/ticket.wasm \
  --source organizer \
  --network testnet)
echo "✓ TicketContract deployed: $TICKET_ID"

echo ""
echo "4. Deploying MarketplaceContract..."
MARKETPLACE_ID=$("$STELLAR_CLI" contract deploy \
  --wasm contracts/target/wasm32v1-none/release/marketplace.wasm \
  --source organizer \
  --network testnet)
echo "✓ MarketplaceContract deployed: $MARKETPLACE_ID"

# Testnet native XLM SAC address — read from environment (never hardcoded here).
XLM_TESTNET="${XLM_TESTNET_TOKEN}"

echo ""
echo "5. Initializing TicketContract..."
# Get deployer address from the organizer identity
ADMIN_ADDRESS=$("$STELLAR_CLI" keys address organizer)
"$STELLAR_CLI" contract invoke \
  --id $TICKET_ID \
  --source organizer \
  --network testnet \
  -- \
  initialize \
  --admin $ADMIN_ADDRESS \
  --marketplace_address $MARKETPLACE_ID \
  --xlm_token $XLM_TESTNET
echo "✓ TicketContract initialized."

echo ""
echo "6. Initializing MarketplaceContract (10% Royalty)..."
"$STELLAR_CLI" contract invoke \
  --id $MARKETPLACE_ID \
  --source organizer \
  --network testnet \
  -- \
  initialize \
  --admin $ADMIN_ADDRESS \
  --ticket_contract_address $TICKET_ID \
  --royalty_rate 10
echo "✓ MarketplaceContract initialized."

echo ""
echo "======================================================="
echo "✅ DEPLOYMENT SUCCESSFUL"
echo "======================================================="
echo "Ticket Contract ID:      $TICKET_ID"
echo "Marketplace Contract ID: $MARKETPLACE_ID"
echo "XLM Token Address:       $XLM_TESTNET"
echo ""

# Update only deployment-owned keys so existing Supabase and local app
# settings survive a coordinated contract deployment.
mkdir -p frontend
ENV_FILE="frontend/.env.local"
touch "$ENV_FILE"

set_env_value() {
  key="$1"
  value="$2"
  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >> "$ENV_FILE"
  fi
}

set_env_value "VITE_TICKET_CONTRACT_ID" "$TICKET_ID"
set_env_value "VITE_MARKETPLACE_CONTRACT_ID" "$MARKETPLACE_ID"
set_env_value "VITE_NETWORK_PASSPHRASE" '"Test SDF Network ; September 2015"'
set_env_value "VITE_RPC_URL" '"https://soroban-testnet.stellar.org:443"'
set_env_value "VITE_HORIZON_URL" '"https://horizon-testnet.stellar.org"'
set_env_value "VITE_STELLAR_EXPLORER_URL" '"https://stellar.expert/explorer/testnet"'

echo "Update the Supabase function deployment scope before enabling organizer writes:"
echo "npx supabase secrets set STELLAR_NETWORK=StellarTestnet STELLAR_NETWORK_PASSPHRASE='Test SDF Network ; September 2015' TICKET_CONTRACT_ID=$TICKET_ID MARKETPLACE_CONTRACT_ID=$MARKETPLACE_ID STELLAR_RPC_URL=https://soroban-testnet.stellar.org:443"

echo "✓ Saved contract IDs to frontend/.env.local"
