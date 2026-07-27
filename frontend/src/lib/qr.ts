import { Keypair } from '@stellar/stellar-sdk';
import type { MessageSignFn } from '../types';

const PAYLOAD_EXPIRY_SECONDS = 45;

export type QRVerificationFailure = 'malformed' | 'expired' | 'invalid_signature';

export type QRVerificationResult =
  | { ok: true; walletAddress: string; ticketId: string; timestamp: number }
  | { ok: false; reason: QRVerificationFailure };

export async function buildQRPayload(
  walletAddress: string,
  ticketId: string,
  signMessage: MessageSignFn,
): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${walletAddress}:${ticketId}:${timestamp}`;
  const signature = await signMessage(
    Buffer.from(message, 'utf8'),
    `qr:${ticketId}:${timestamp}`,
  );
  return `${message}:${Buffer.from(signature).toString('base64')}`;
}

export function verifyQRPayload(
  raw: string,
): QRVerificationResult {
  const parts = raw.split(':');
  if (parts.length !== 4) return { ok: false, reason: 'malformed' };
  const [walletAddress, ticketId, timestampStr, base64Signature] = parts;
  if (!walletAddress || !ticketId || !timestampStr || !base64Signature) {
    return { ok: false, reason: 'malformed' };
  }

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: 'malformed' };
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) >= PAYLOAD_EXPIRY_SECONDS) {
    return { ok: false, reason: 'expired' };
  }

  try {
    const message = Buffer.from(`${walletAddress}:${ticketId}:${timestampStr}`, 'utf8');
    const signature = Buffer.from(base64Signature, 'base64');
    return Keypair.fromPublicKey(walletAddress).verify(message, signature)
      ? { ok: true, walletAddress, ticketId, timestamp }
      : { ok: false, reason: 'invalid_signature' };
  } catch {
    return { ok: false, reason: 'invalid_signature' };
  }
}
