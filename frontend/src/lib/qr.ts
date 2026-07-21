import { Keypair } from '@stellar/stellar-sdk';

// QR payload format (D-027, D-028):
//   {wallet_address}:{ticket_id}:{timestamp}:{base64Signature}
//
// The signature covers the UTF-8 bytes of "{wallet_address}:{ticket_id}:{timestamp}".
// Verification uses Keypair.verify() — no network call needed. (D-005)
// Timestamp check is |now - timestamp| < 45s — NOT a windowed floor. (D-006)

// PAYLOAD_EXPIRY_SECONDS provides a 15-second grace period for device clock drift,
// even though the UI continues to generate a fresh QR code every 30 seconds.
const PAYLOAD_EXPIRY_SECONDS = 45;

/**
 * Build a signed QR payload string.
 * Only callable by Burner Wallet attendees who have a local secret key. (D-028)
 * Organizers use Freighter and are scanners — they never call this function.
 *
 * @param walletAddress - The attendee's Stellar public key (G... address)
 * @param ticketId      - The on-chain ticket ID
 * @param secretKey     - The burner wallet secret key (S... key from localStorage)
 * @returns             - The full signed payload string, ready to encode as QR
 */
export function buildQRPayload(
  walletAddress: string,
  ticketId: string,
  secretKey: string
): string {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${walletAddress}:${ticketId}:${timestamp}`;
  const messageBytes = Buffer.from(message, 'utf8');

  const keypair = Keypair.fromSecret(secretKey);
  const signatureBytes = keypair.sign(messageBytes);
  const base64Signature = Buffer.from(signatureBytes).toString('base64');

  return `${message}:${base64Signature}`;
}

/**
 * Verify a signed QR payload string.
 * Returns the parsed wallet address and ticket ID if the payload is valid,
 * or null if any check fails (expired, malformed, or invalid signature).
 *
 * Checks performed (in order):
 *   1. Format: exactly 4 colon-delimited parts
 *   2. Timestamp: |now - timestamp| < 45s  (D-006 — absolute, not windowed; 30s rotation + 15s clock-drift grace)
 *   3. Signature: ed25519 verify against the wallet's public key  (D-005)
 */
export function verifyQRPayload(
  raw: string
): { walletAddress: string; ticketId: string } | null {
  // Split on ':' but only into 4 parts — base64 may contain '=' but not ':'
  const parts = raw.split(':');
  if (parts.length !== 4) return null;

  const [walletAddress, ticketId, timestampStr, base64Signature] = parts;

  if (!walletAddress || !ticketId || !timestampStr || !base64Signature) return null;

  // Timestamp check (D-006)
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return null;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) >= PAYLOAD_EXPIRY_SECONDS) return null;

  // Signature check (D-005)
  try {
    const message = `${walletAddress}:${ticketId}:${timestampStr}`;
    const messageBytes = Buffer.from(message, 'utf8');
    const signatureBytes = Buffer.from(base64Signature, 'base64');

    const keypair = Keypair.fromPublicKey(walletAddress);
    const isValid = keypair.verify(messageBytes, signatureBytes);

    if (!isValid) return null;
  } catch {
    // Invalid public key format or corrupt signature bytes
    return null;
  }

  return { walletAddress, ticketId };
}
