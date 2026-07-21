#!/bin/bash

# Exit on any error
set -e

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
if ! stellar keys ls | grep -q "\borganizer\b"; then
    echo "❌ ERROR: 'organizer' identity not found."
    echo "Run 'bash scripts/fund.sh' first to generate and fund the deployment account."
    exit 1
fi

echo "1. Compiling WASM binaries..."
cd contracts
cargo build --target wasm32v1-none --release
cd ..

echo ""
echo "2. Deploying TicketContract..."
TICKET_ID=$(stellar contract deploy \
  --wasm contracts/target/wasm32v1-none/release/ticket.wasm \
  --source organizer \
  --network testnet)
echo "✓ TicketContract deployed: $TICKET_ID"

echo ""
echo "3. Deploying MarketplaceContract..."
MARKETPLACE_ID=$(stellar contract deploy \
  --wasm contracts/target/wasm32v1-none/release/marketplace.wasm \
  --source organizer \
  --network testnet)
echo "✓ MarketplaceContract deployed: $MARKETPLACE_ID"

# Testnet native XLM SAC address — read from environment (never hardcoded here).
XLM_TESTNET="${XLM_TESTNET_TOKEN}"

echo ""
echo "4. Initializing TicketContract..."
# Get deployer address from the organizer identity
ADMIN_ADDRESS=$(stellar keys address organizer)
stellar contract invoke \
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
echo "5. Initializing MarketplaceContract (10% Royalty)..."
stellar contract invoke \
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

# Write to a .env file for the frontend
mkdir -p frontend
cat <<EOF > frontend/.env.local
VITE_TICKET_CONTRACT_ID=$TICKET_ID
VITE_MARKETPLACE_CONTRACT_ID=$MARKETPLACE_ID
VITE_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
VITE_RPC_URL="https://soroban-testnet.stellar.org:443"
EOF

echo "✓ Saved contract IDs to frontend/.env.local"
