# Slice 1 Dfns proof protocol

This proof is intentionally isolated from the public checkout and all burner-owned tickets.

## Preconditions

- Deploy a disposable TicketContract/MarketplaceContract pair to Stellar Testnet.
- Create one disposable active event on that pair.
- Set `VITE_ENABLE_DFNS_PROOF=true`, `VITE_DFNS_PROOF_TICKET_CONTRACT_ID`, and
  `VITE_DFNS_PROOF_EVENT_ID` only in the local proof environment.
- Configure Supabase Auth, the `attendee-wallet` Edge Function, Dfns service secrets,
  and the WebAuthn relying-party domain.

The proof helper refuses to use `VITE_TICKET_CONTRACT_ID`, does not call
`readModelSync`, and is not mounted as an application route.

## Evidence sequence

1. Authenticate the disposable Supabase user in Browser A.
2. Provision the delegated wallet, save the displayed recovery code, and record
   only its public address in the evidence sheet.
3. From a development console import and run `runIsolatedDfnsPurchaseProof()`.
4. Record the disposable event ID, ticket ID, transaction hash from RPC, and the
   local QR verification result.
5. Sign out. In Browser B authenticate the same Supabase user and verify the
   Account page restores the same address.
6. Run the proof helper again with a second disposable ticket ID.
7. Remove Browser A's passkey, complete recovery in the recovery test harness,
   register a replacement passkey, and repeat message signing.
8. Inspect browser storage, Supabase client-readable responses, and logs. No
   Stellar secret, Dfns user ID, signing-key ID, recovery record, or audit record
   may be present.

If any restoration step fails, the public wallet row must become
`recovery_required`. Creating another wallet is a failed proof.
