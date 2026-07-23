import { Keypair } from '@stellar/stellar-sdk';
import type { MessageSignFn } from '../types';

const PAYLOAD_EXPIRY_SECONDS = 45;

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
): { walletAddress: string; ticketId: string } | null {
  const parts = raw.split(':');
  if (parts.length !== 4) return null;
  const [walletAddress, ticketId, timestampStr, base64Signature] = parts;
  if (!walletAddress || !ticketId || !timestampStr || !base64Signature) return null;

  const timestamp = Number.parseInt(timestampStr, 10);
  if (!Number.isFinite(timestamp)) return null;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) >= PAYLOAD_EXPIRY_SECONDS) return null;

  try {
    const message = Buffer.from(`${walletAddress}:${ticketId}:${timestampStr}`, 'utf8');
    const signature = Buffer.from(base64Signature, 'base64');
    return Keypair.fromPublicKey(walletAddress).verify(message, signature)
      ? { walletAddress, ticketId }
      : null;
  } catch {
    return null;
  }
}
