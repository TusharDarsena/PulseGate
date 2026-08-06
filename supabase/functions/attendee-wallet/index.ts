import { DfnsApiClient, DfnsDelegatedApiClient } from 'npm:@dfns/sdk@0.8.25';
import { AsymmetricKeySigner } from 'npm:@dfns/sdk-keysigner@0.8.25';
import { createClient } from 'npm:@supabase/supabase-js@2.57.4';

const cors = {
  'Access-Control-Allow-Origin': Deno.env.get('APP_ORIGIN') ?? '',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...cors,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
      Pragma: 'no-cache',
    },
  });

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Server configuration is missing ${name}.`);
  return value;
}

function serviceDfns(authToken = required('DFNS_SERVICE_ACCOUNT_TOKEN')) {
  return new DfnsApiClient({
    baseUrl: required('DFNS_API_URL'),
    authToken,
    signer: new AsymmetricKeySigner({
      credId: required('DFNS_SERVICE_ACCOUNT_CRED_ID'),
      privateKey: required('DFNS_SERVICE_ACCOUNT_PRIVATE_KEY'),
      algorithm: 'sha256',
    }),
  });
}

function delegatedDfns(authToken: string) {
  return new DfnsDelegatedApiClient({
    baseUrl: required('DFNS_API_URL'),
    authToken,
    orgId: required('DFNS_ORG_ID'),
  });
}

class HttpError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

type WalletProviderLink = {
  provider_user_id: string | null;
  provider_wallet_id: string | null;
  provider_signing_key_id: string | null;
};

async function findDfnsEndUserByUsername(
  dfns: ReturnType<typeof serviceDfns>,
  username: string,
) {
  let paginationToken: string | undefined;
  do {
    const page = await dfns.auth.listUsers({
      query: { kind: 'EndUser', limit: 200, paginationToken },
    });
    const match = page.items.find((candidate) => candidate.username === username);
    if (match) return match;
    if (!page.nextPageToken || page.nextPageToken === paginationToken) return null;
    paginationToken = page.nextPageToken;
  } while (paginationToken);
  return null;
}

async function markWalletRecoveryRequired(
  admin: ReturnType<typeof createClient>,
  userId: string,
  address: string | null,
) {
  const { error } = await admin.from('attendee_wallets').upsert({
    user_id: userId,
    address,
    readiness: 'recovery_required',
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

async function reconcilePendingRegistration(
  admin: ReturnType<typeof createClient>,
  userId: string,
  username: string,
  link: WalletProviderLink,
  walletAddress: string | null,
) {
  // Local wallet/key IDs are durable evidence that provisioning crossed the
  // point where starting over could create a second wallet.
  if (link.provider_wallet_id || link.provider_signing_key_id) {
    await markWalletRecoveryRequired(admin, userId, walletAddress);
    return 'recovery_required';
  }

  const dfns = serviceDfns();
  const providerUser = link.provider_user_id
    ? await dfns.auth.getUser({ userId: link.provider_user_id })
    : await findDfnsEndUserByUsername(dfns, username);

  if (!providerUser) return 'restart';
  if (providerUser.username !== username) {
    throw new Error('The recorded Dfns identity does not match this account. Recovery is required.');
  }

  if (!link.provider_user_id) {
    const { error } = await admin.from('wallet_provider_links').update({
      provider_user_id: providerUser.userId,
      updated_at: new Date().toISOString(),
    }).eq('user_id', userId).is('provider_user_id', null);
    if (error) throw error;
  }

  if (providerUser.isRegistered) {
    await markWalletRecoveryRequired(admin, userId, walletAddress);
    return 'recovery_required';
  }

  // Dfns confirms this identity has no registered credentials, so it cannot
  // own a delegated wallet. Archive it before creating the retry challenge.
  await dfns.auth.archiveUser({ userId: providerUser.userId });
  return 'restart';
}

async function enforceRecoveryRateLimit(
  admin: ReturnType<typeof createClient>,
  userId: string,
  action: 'recovery-init' | 'recovery-complete',
) {
  const { data, error } = await admin.rpc('consume_wallet_recovery_rate_limit', {
    p_user_id: userId,
    p_action: action,
  });
  if (error) throw error;
  if (data !== true) throw new HttpError(429, 'Too many recovery attempts. Try again later.');
}

function validateSignatureRequest(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object') throw new Error('Missing signature request.');
  const request = value as Record<string, unknown>;
  if (request.kind === 'Transaction') {
    if (request.network !== 'StellarTestnet' || typeof request.transaction !== 'string') {
      throw new Error('Only Stellar Testnet transaction XDR is accepted.');
    }
    if (
      request.externalId !== undefined &&
      (
        typeof request.externalId !== 'string' ||
        !/^purchase:[0-9a-f-]{36}:\d+:[0-9a-f]{64}$/i.test(request.externalId)
      )
    ) {
      throw new Error('The transaction operation attempt ID is invalid.');
    }
  } else if (request.kind === 'Message') {
    if (typeof request.message !== 'string' || !request.message.startsWith('0x')) {
      throw new Error('Message signatures require hexadecimal bytes.');
    }
  } else {
    throw new Error('Unsupported signature kind.');
  }
  return request;
}

// Dfns signs the exact JSON payload supplied during challenge creation. Keep
// object key ordering deterministic on both sides of the Postgres jsonb
// round-trip because jsonb does not preserve the insertion order of keys.
function canonicalizeJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeJson(entry)]),
  );
}

function isInvalidUserActionSignature(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error
    ? (error as { status?: unknown }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return status === 406 || /user action signature is invalid/i.test(message);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);

  try {
    const supabaseUrl = required('SUPABASE_URL');
    const authHeader = request.headers.get('Authorization') ?? '';
    const authClient = createClient(supabaseUrl, required('SUPABASE_ANON_KEY'), {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: userError } = await authClient.auth.getUser();
    if (userError || !user) return json({ error: 'Authentication required.' }, 401);

    const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'));
    const body = await request.json() as Record<string, unknown>;
    const action = body.action;
    const username = `stellar-${user.id}`;

    if (action === 'registration-init') {
      const [{ data: wallet }, { data: link }] = await Promise.all([
        admin.from('attendee_wallets').select('address,readiness').eq('user_id', user.id).maybeSingle(),
        admin.from('wallet_provider_links')
          .select('provider_user_id,provider_wallet_id,provider_signing_key_id')
          .eq('user_id', user.id)
          .maybeSingle(),
      ]);
      if (wallet?.readiness === 'ready') {
        return json({ error: 'The attendee wallet already exists.' }, 409);
      }
      if (wallet?.address) {
        await markWalletRecoveryRequired(admin, user.id, wallet.address);
        return json({
          error: 'The recorded wallet must be recovered; a replacement will not be created.',
        }, 409);
      }
      if (link) {
        const pendingState = await reconcilePendingRegistration(
          admin,
          user.id,
          username,
          link,
          wallet?.address ?? null,
        );
        if (pendingState === 'recovery_required') {
          return json({
            error: 'The recorded wallet setup must be recovered; a replacement will not be created.',
          }, 409);
        }
      }

      const challenge = await serviceDfns().auth.createDelegatedRegistrationChallenge({
        body: { email: username, kind: 'EndUser', externalId: user.id },
      });
      const createdUser = await findDfnsEndUserByUsername(serviceDfns(), username);
      if (!createdUser || createdUser.isRegistered) {
        throw new Error('Dfns did not return a new pending user for wallet registration.');
      }
      const {
        temporaryAuthenticationToken,
        allowedRecoveryCredentials: _allowedRecoveryCredentials,
        ...publicChallenge
      } = challenge;
      const providerLink = {
        provider_user_id: createdUser.userId,
        provider_wallet_id: null,
        provider_signing_key_id: null,
        provider_recovery_credential_id: null,
        temporary_auth_token: temporaryAuthenticationToken,
        recovery_state: 'required',
        recovery_challenge_expires_at: null,
        updated_at: new Date().toISOString(),
      };
      const { error: linkError } = link
        ? await admin.from('wallet_provider_links').update(providerLink).eq('user_id', user.id)
        : await admin.from('wallet_provider_links').insert({
          user_id: user.id,
          provider: 'dfns',
          provider_username: username,
          ...providerLink,
        });
      if (linkError) {
        try {
          await serviceDfns().auth.archiveUser({ userId: createdUser.userId });
        } catch (cleanupError) {
          console.error('[attendee-wallet] could not archive an unlinked Dfns user', cleanupError);
        }
        throw linkError;
      }
      const { error: walletError } = await admin.from('attendee_wallets').upsert({
        user_id: user.id,
        readiness: 'provisioning',
        updated_at: new Date().toISOString(),
      });
      if (walletError) throw walletError;
      return json({ challenge: publicChallenge });
    }

    if (action === 'registration-complete') {
      if (!body.firstFactorCredential || !body.recoveryCredential) {
        throw new Error('Both a passkey and a user-held recovery credential are required.');
      }
      const { data: link, error: linkError } = await admin
        .from('wallet_provider_links')
        .select('temporary_auth_token,provider_user_id,provider_wallet_id,provider_signing_key_id')
        .eq('user_id', user.id)
        .single();
      if (
        linkError ||
        !link?.temporary_auth_token ||
        !link.provider_user_id ||
        link.provider_wallet_id ||
        link.provider_signing_key_id
      ) {
        throw new Error('No resumable wallet registration exists.');
      }

      const registered = await serviceDfns(link.temporary_auth_token).auth.register({
        body: {
          firstFactorCredential: body.firstFactorCredential,
          recoveryCredential: body.recoveryCredential,
        },
      });
      if (registered.user.id !== link.provider_user_id) {
        throw new Error('Dfns registered an unexpected user. Recovery is required.');
      }
      const wallet = await serviceDfns().wallets.createWallet({
        body: { network: 'StellarTestnet', delegateTo: registered.user.id },
      });
      if (!wallet.address) {
        throw new Error('Dfns created no usable Stellar address; operator recovery is required.');
      }
      const { error: updateError } = await admin.from('wallet_provider_links').update({
        provider_user_id: registered.user.id,
        provider_wallet_id: wallet.id,
        provider_signing_key_id: wallet.signingKey.id,
        provider_recovery_credential_id: (
          body.recoveryCredential as { credentialInfo: { credId: string } }
        ).credentialInfo.credId,
        temporary_auth_token: null,
        recovery_state: 'ready',
        updated_at: new Date().toISOString(),
      })
        .eq('user_id', user.id)
        .eq('provider_user_id', registered.user.id)
        .is('provider_wallet_id', null)
        .is('provider_signing_key_id', null)
        .select('user_id')
        .single();
      if (updateError) throw updateError;
      const { error: walletError } = await admin.from('attendee_wallets').upsert({
        user_id: user.id,
        address: wallet.address,
        network: 'StellarTestnet',
        readiness: 'ready',
        updated_at: new Date().toISOString(),
      });
      if (walletError) throw walletError;
      const { error: auditError } = await admin.from('wallet_audit_log').insert({
        user_id: user.id,
        action: 'wallet_registered',
        outcome: 'success',
      });
      if (auditError) throw auditError;
      return json({ address: wallet.address, network: 'StellarTestnet', readiness: 'ready' });
    }

    const { data: link, error: linkError } = await admin
      .from('wallet_provider_links')
      .select('provider_username,provider_signing_key_id,provider_recovery_credential_id')
      .eq('user_id', user.id)
      .single();
    if (linkError || !link?.provider_signing_key_id) {
      throw new Error('The recorded delegated wallet is not ready.');
    }

    if (action === 'recovery-init') {
      await enforceRecoveryRateLimit(admin, user.id, 'recovery-init');
      if (!link.provider_recovery_credential_id) {
        throw new Error('No recovery credential is registered for this wallet.');
      }
      const challenge = await serviceDfns().auth.createDelegatedRecoveryChallenge({
        body: {
          username: link.provider_username,
          credentialId: link.provider_recovery_credential_id,
        },
      });
      const encrypted = challenge.allowedRecoveryCredentials.find(
        (credential) => credential.id === link.provider_recovery_credential_id,
      )?.encryptedRecoveryKey;
      if (!encrypted) throw new Error('The recorded recovery credential is unavailable.');
      const {
        temporaryAuthenticationToken,
        allowedRecoveryCredentials: _allowedRecoveryCredentials,
        ...publicChallenge
      } = challenge;
      await admin.from('wallet_provider_links').update({
        temporary_auth_token: temporaryAuthenticationToken,
        recovery_challenge_expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
      }).eq('user_id', user.id);
      return json({
        challenge: publicChallenge,
        credentialId: link.provider_recovery_credential_id,
        encryptedPrivateKey: encrypted,
      });
    }

    if (action === 'recovery-complete') {
      await enforceRecoveryRateLimit(admin, user.id, 'recovery-complete');
      if (!body.recovery || !body.firstFactorCredential || !body.recoveryCredential) {
        throw new Error('Recovery approval and replacement credentials are required.');
      }
      const { data: recoveryLink, error: recoveryLinkError } = await admin
        .from('wallet_provider_links')
        .select('temporary_auth_token,recovery_challenge_expires_at')
        .eq('user_id', user.id)
        .single();
      if (
        recoveryLinkError ||
        !recoveryLink?.temporary_auth_token ||
        !recoveryLink.recovery_challenge_expires_at ||
        new Date(recoveryLink.recovery_challenge_expires_at).getTime() <= Date.now()
      ) {
        throw new Error('No active recovery challenge exists.');
      }
      const recoveryToken = recoveryLink.temporary_auth_token;
      const { data: claimed, error: claimError } = await admin
        .from('wallet_provider_links')
        .update({
          temporary_auth_token: 'consumed',
          recovery_challenge_expires_at: null,
        })
        .eq('user_id', user.id)
        .eq('temporary_auth_token', recoveryToken)
        .gt('recovery_challenge_expires_at', new Date().toISOString())
        .select('user_id')
        .maybeSingle();
      if (claimError || !claimed) throw new Error('Recovery challenge is invalid or already used.');

      await serviceDfns(recoveryToken).auth.recover({
        body: {
          recovery: body.recovery,
          newCredentials: {
            firstFactorCredential: body.firstFactorCredential,
            recoveryCredential: body.recoveryCredential,
          },
        },
      });
      await admin.from('wallet_provider_links').update({
        provider_recovery_credential_id: (
          body.recoveryCredential as { credentialInfo: { credId: string } }
        ).credentialInfo.credId,
        temporary_auth_token: null,
        recovery_challenge_expires_at: null,
        recovery_state: 'ready',
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
      await admin.from('attendee_wallets').update({
        readiness: 'ready',
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);
      await admin.from('wallet_audit_log').insert({
        user_id: user.id,
        action: 'wallet_recovered',
        outcome: 'success',
      });
      return json({ readiness: 'ready' });
    }

    if (action === 'signature-init') {
      const signatureRequest = validateSignatureRequest(body.request);
      // FIX: String(undefined) === "undefined", which is truthy.
      // Without the explicit undefined-check, a Transaction request with no
      // externalId would produce attemptExternalId = "undefined", enter the
      // if-block, query the DB for external_id = "undefined" (finds nothing),
      // and throw "The purchase attempt is not awaiting approval." → 400.
      const attemptExternalId = signatureRequest.kind === 'Transaction' && signatureRequest.externalId !== undefined
        ? String(signatureRequest.externalId)
        : null;
      if (attemptExternalId) {
        const { data: attempt, error: attemptError } = await admin
          .from('purchase_operation_attempts')
          .select('operation_id,state')
          .eq('external_id', attemptExternalId)
          .eq('state', 'approval_required')
          .single();
        if (attemptError || !attempt) throw new Error('The purchase attempt is not awaiting approval.');
        const { data: operation, error: operationError } = await admin
          .from('purchase_operations')
          .select('user_id,state')
          .eq('operation_id', attempt.operation_id)
          .eq('user_id', user.id)
          .eq('state', 'approval_required')
          .single();
        if (operationError || !operation) {
          throw new Error('The purchase attempt does not belong to this attendee.');
        }
        await admin
          .from('wallet_action_challenges')
          .update({
            consumed_at: new Date().toISOString(),
            provider_auth_token: 'expired',
          })
          .eq('user_id', user.id)
          .eq('operation_attempt_external_id', attemptExternalId)
          .is('consumed_at', null)
          .lte('expires_at', new Date().toISOString());
        const { data: existing } = await admin
          .from('wallet_action_challenges')
          .select('request_id,provider_request')
          .eq('user_id', user.id)
          .eq('operation_attempt_external_id', attemptExternalId)
          .is('consumed_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle();
        const storedProvider = existing?.provider_request as {
          publicChallenge?: unknown;
        } | undefined;
        if (existing && storedProvider?.publicChallenge) {
          return json({
            requestId: existing.request_id,
            challenge: storedProvider.publicChallenge,
          });
        }
      }
      const { token } = await serviceDfns().auth.delegatedLogin({
        body: { username: link.provider_username },
      });
      const delegated = delegatedDfns(token);
      // Strip externalId before forwarding to Dfns: it is our internal DB
      // tracking field (format: purchase:<uuid>:<attempt>:<hash>) and is not a
      // Dfns concept. Passing it causes Dfns to reject with
      // "request body failed validation". Our dedup is handled via
      // wallet_action_challenges.operation_attempt_external_id instead.
      const { externalId: _externalId, ...signatureRequestForDfns } = signatureRequest;
      const providerRequest = {
        keyId: link.provider_signing_key_id,
        body: canonicalizeJson(signatureRequestForDfns) as Record<string, unknown>,
      };
      const challenge = await delegated.keys.generateSignatureInit(providerRequest);
      const { challengeIdentifier, ...publicChallenge } = challenge;
      const { data: stored, error: storeError } = await admin
        .from('wallet_action_challenges')
        .insert({
          user_id: user.id,
          action: 'signature',
          provider_auth_token: token,
          provider_request: {
            request: providerRequest,
            challengeIdentifier,
            publicChallenge,
          },
          operation_attempt_external_id: attemptExternalId,
          expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
        })
        .select('request_id')
        .single();
      if (storeError) throw storeError;
      return json({ requestId: stored.request_id, challenge: publicChallenge });
    }

    if (action === 'signature-complete') {
      const { data: stored, error: storedError } = await admin
        .from('wallet_action_challenges')
        .select('*')
        .eq('request_id', body.requestId)
        .eq('user_id', user.id)
        .is('consumed_at', null)
        .gt('expires_at', new Date().toISOString())
        .single();
      if (storedError || !stored) throw new Error('Signing challenge is invalid or expired.');
      const provider = stored.provider_request as {
        request: Parameters<ReturnType<typeof delegatedDfns>['keys']['generateSignatureComplete']>[0];
        challengeIdentifier: string;
        publicChallenge?: unknown;
      };
      const canonicalRequest = canonicalizeJson(provider.request) as typeof provider.request;
      let result;
      try {
        result = await delegatedDfns(stored.provider_auth_token).keys.generateSignatureComplete(
          canonicalRequest,
          {
            challengeIdentifier: provider.challengeIdentifier,
            firstFactor: body.assertion,
          },
        );
      } catch (error) {
        // Do not keep reusing a challenge that Dfns rejected. The next attempt
        // must receive a fresh challenge, especially after a payload-ordering
        // mismatch from an older jsonb-persisted request.
        if (isInvalidUserActionSignature(error)) {
          await admin.from('wallet_action_challenges')
            .update({ consumed_at: new Date().toISOString(), provider_auth_token: 'rejected' })
            .eq('request_id', stored.request_id)
            .is('consumed_at', null);
        }
        throw error;
      }
      await admin.from('wallet_action_challenges')
        .update({ consumed_at: new Date().toISOString(), provider_auth_token: 'consumed' })
        .eq('request_id', stored.request_id);
      await admin.from('wallet_audit_log').insert({
        user_id: user.id,
        action: 'delegated_signature',
        outcome: 'success',
        detail: { kind: canonicalRequest.body.kind },
      });
      return json({ signedData: result.signedData, signatures: result.signatures });
    }

    return json({ error: 'Unknown wallet action.' }, 400);
  } catch (error) {
    console.error('[attendee-wallet]', error instanceof Error ? error.message : error);
    const status = error instanceof HttpError ? error.status : 400;
    return json({ error: error instanceof Error ? error.message : 'Wallet service failed.' }, status);
  }
});
