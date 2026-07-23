import { BrowserKeySigner, WebAuthnSigner } from '@dfns/sdk-browser';
import type { RecoveryKeyAttestation, UserRegistrationChallenge } from '@dfns/sdk';
import { rawSignatureToAns1 } from '@dfns/sdk/utils';
import { TransactionBuilder } from '@stellar/stellar-sdk';
import type { MessageSignFn, SignFn } from '../types';
import { NETWORK_PASSPHRASE, SUPABASE_URL } from './constants';
import { supabase } from './supabase';

type Challenge = Parameters<WebAuthnSigner['sign']>[0];
type AttestationChallenge = Parameters<WebAuthnSigner['create']>[0];

function getSigner() {
  const rpId = import.meta.env.VITE_DFNS_RP_ID || window.location.hostname;
  return new WebAuthnSigner({
    relyingParty: { id: rpId, name: 'StellarTickets' },
  });
}

async function invoke<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in is required.');

  const response = await fetch(`${SUPABASE_URL}/functions/v1/attendee-wallet`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...body }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Wallet service unavailable.');
  return payload as T;
}

function base64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64url');
}

async function createRecoveryCredential(
  challenge: AttestationChallenge,
): Promise<{ credential: RecoveryKeyAttestation; recoveryCode: string }> {
  const keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const recoveryCode = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const keyAttestation = await new BrowserKeySigner({ keyPair }).create(
    challenge as UserRegistrationChallenge,
  );
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(recoveryCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const encryptionKey = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt'],
  );
  const privateKey = await crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, encryptionKey, privateKey);
  return {
    recoveryCode,
    credential: {
      credentialKind: 'RecoveryKey',
      credentialInfo: keyAttestation.credentialInfo,
      encryptedPrivateKey: JSON.stringify({
        version: 1,
        kdf: 'PBKDF2-SHA256',
        iterations: 210_000,
        cipher: 'AES-256-GCM',
        salt: base64Url(salt),
        iv: base64Url(iv),
        data: base64Url(new Uint8Array(encrypted)),
      }),
    },
  };
}

function bytesFromBase64Url(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64url'));
}

function arrayBufferFromBase64Url(value: string): ArrayBuffer {
  const bytes = bytesFromBase64Url(value);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function recoverPrivateKey(encryptedPrivateKey: string, recoveryCode: string) {
  const payload = JSON.parse(encryptedPrivateKey) as {
    iterations: number;
    salt: string;
    iv: string;
    data: string;
  };
  const passwordKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(recoveryCode),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  const key = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: arrayBufferFromBase64Url(payload.salt),
      iterations: payload.iterations,
    },
    passwordKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  );
  const pkcs8 = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: arrayBufferFromBase64Url(payload.iv) },
    key,
    arrayBufferFromBase64Url(payload.data),
  );
  return crypto.subtle.importKey(
    'pkcs8',
    pkcs8,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
}

export async function recoverDelegatedWallet(recoveryCode: string): Promise<string> {
  const init = await invoke<{
    challenge: AttestationChallenge & { challenge: string };
    credentialId: string;
    encryptedPrivateKey: string;
  }>('recovery-init');
  const privateKey = await recoverPrivateKey(init.encryptedPrivateKey, recoveryCode);
  const clientData = JSON.stringify({ type: 'key.get', challenge: init.challenge.challenge });
  const raw = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(clientData),
  );
  const signature = rawSignatureToAns1(new Uint8Array(raw));
  const recovery = {
    kind: 'RecoveryKey',
    credentialAssertion: {
      credId: init.credentialId,
      clientData: base64Url(new TextEncoder().encode(clientData)),
      signature: base64Url(signature),
    },
  };
  const firstFactorCredential = await getSigner().create(init.challenge);
  const nextRecovery = await createRecoveryCredential(init.challenge);
  await invoke('recovery-complete', {
    recovery,
    firstFactorCredential,
    recoveryCredential: nextRecovery.credential,
  });
  return nextRecovery.recoveryCode;
}

export async function provisionDelegatedWallet(): Promise<string> {
  const init = await invoke<{ challenge: AttestationChallenge }>('registration-init');
  const firstFactorCredential = await getSigner().create(init.challenge);
  const { credential: recoveryCredential, recoveryCode } =
    await createRecoveryCredential(init.challenge);
  await invoke('registration-complete', { firstFactorCredential, recoveryCredential });
  return recoveryCode;
}

async function delegatedSignature(request: Record<string, unknown>) {
  const init = await invoke<{ requestId: string; challenge: Challenge }>('signature-init', { request });
  const assertion = await getSigner().sign(init.challenge);
  return invoke<{
    signedData?: string;
    signatures?: Record<string, { encoded?: string }>;
  }>('signature-complete', {
    requestId: init.requestId,
    assertion,
  });
}

function bytesFromHex(value: string): Uint8Array {
  const hex = value.startsWith('0x') ? value.slice(2) : value;
  if (hex.length % 2 !== 0) throw new Error('Invalid hexadecimal signature response.');
  return Uint8Array.from(hex.match(/.{2}/g)?.map((byte) => Number.parseInt(byte, 16)) ?? []);
}

export function buildDelegatedSigners(address: string): {
  signFn: SignFn;
  signMessage: MessageSignFn;
} {
  const signFn: SignFn = async (xdr, opts) => {
    const passphrase = opts?.networkPassphrase || NETWORK_PASSPHRASE;
    const transaction = TransactionBuilder.fromXDR(xdr, passphrase);
    const envelopeHex = transaction.toEnvelope().toXDR('hex');
    const result = await delegatedSignature({
      network: 'StellarTestnet',
      kind: 'Transaction',
      transaction: `0x${envelopeHex}`,
    });
    if (!result.signedData) throw new Error('Dfns did not return signed transaction data.');
    return {
      signedTxXdr: Buffer.from(bytesFromHex(result.signedData)).toString('base64'),
      signerAddress: address,
    };
  };

  const signMessage: MessageSignFn = async (message, externalId) => {
    const result = await delegatedSignature({
      kind: 'Message',
      message: `0x${Buffer.from(message).toString('hex')}`,
      externalId,
    });
    const encoded = Object.values(result.signatures ?? {})[0]?.encoded;
    if (!encoded) throw new Error('Dfns did not return an Ed25519 signature.');
    const bytes = bytesFromHex(encoded);
    if (bytes.byteLength !== 64) {
      throw new Error('Dfns signature encoding is incompatible with Stellar Ed25519 verification.');
    }
    return bytes;
  };
  return { signFn, signMessage };
}
