export const TICKET_CONTRACT_ID = import.meta.env.VITE_TICKET_CONTRACT_ID as string;
export const MARKETPLACE_CONTRACT_ID = import.meta.env.VITE_MARKETPLACE_CONTRACT_ID as string;
export const NETWORK_PASSPHRASE = import.meta.env.VITE_NETWORK_PASSPHRASE as string;
export const RPC_URL = import.meta.env.VITE_RPC_URL as string;
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;


if (
  !TICKET_CONTRACT_ID ||
  !MARKETPLACE_CONTRACT_ID ||
  !NETWORK_PASSPHRASE ||
  !RPC_URL ||
  !SUPABASE_URL ||
  !SUPABASE_ANON_KEY
) {
  throw new Error(
    '[constants] Missing required env vars. Run scripts/deploy.sh first, ' +
    'or copy .env.example to .env.local and fill in the values.'
  );
}
