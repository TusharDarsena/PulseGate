# PulseGate deployment audit — 2026-07-30

This is a privacy-safe operational audit. It records public identifiers,
service names, and verification outcomes. It does not contain access tokens,
secret values, participant identities, or raw form data.

## Result

The Supabase recovery/service boundary is synchronized to the current public
Testnet contract IDs. The current TicketContract deployment is **not**
synchronized to the repository’s four-argument check-in ABI, so the coordinated
contract/frontend cutover and end-to-end demonstrations remain incomplete.

## Stellar contract audit

Configured frontend deployment:

- Network: Stellar Testnet
- TicketContract:
  `CDO4I4NMRXSTKBL3K7D3WWGRTVNRAUVOMKPKA6X726SY6SYQRBPQIDDQ`
- MarketplaceContract:
  `CC34MVNENC3VD26RJ42SVQXPDZ3JYZJBBNIHHXCX4EDIGUSPZOPDBC6M`

Read-only CLI inspection of the deployed TicketContract reported:

```text
mark_used --ticket_id <String> --organizer <Address>
```

Current source and generated bindings require:

```text
mark_used(event_id, ticket_id, expected_owner, organizer)
```

Outcome: check-in must remain described as code-complete and locally tested,
not currently deployed/live.

## Supabase migration audit

Linked project status: `ACTIVE_HEALTHY`.

Five pending migrations were reviewed with `supabase db push --dry-run` and
then applied successfully:

1. `202607280002_harden_wallet_recovery.sql`
2. `202607290001_slice_3_check_in_operations.sql`
3. `202607290002_phase_5_ticket_operations.sql`
4. `202607290003_part_3_organizer_editor_correctness.sql`
5. `202607290004_part_6_listing_truth_and_ticket_visibility.sql`

The five earlier repository migrations were already present remotely.

## Edge Function audit

The following JWT-protected functions were reported `ACTIVE` after deployment
verification:

| Function | Status |
|---|---|
| `attendee-wallet` | Active |
| `purchase-operation` | Active |
| `event-publication` | Active |
| `test-funding` | Active |
| `organizer-event-operation` | Active |
| `ticket-operation` | Active; deployed during this audit |
| `check-in-operation` | Active; deployed during this audit |

## Secret-name audit

Secret values were not read or recorded. The CLI reported required names for:

- Stellar network, passphrase, RPC, Horizon, and Friendbot;
- TicketContract ID;
- Supabase service/JWKS/database configuration;
- Dfns delegated-wallet configuration;
- application origin.

`MARKETPLACE_CONTRACT_ID` was missing. During this audit, both public contract
ID secrets were set to the same current IDs used by `frontend/.env.local`.

## Local verification

| Check | Result |
|---|---|
| Focused new frontend tests | 14/14 passed |
| Full frontend Vitest suite | 55/55 passed |
| Frontend lint | Passed |
| Frontend production build | Passed; existing bundle-size warning only |
| Contract formatting | Passed |
| Deployable GNU `wasm32v1-none` release build | Passed |
| Native `cargo test` | Blocked: Git `link.exe` was selected instead of Visual C++ linker |

The native-test failure is an environment/toolchain failure documented in
`contracts/AGENTS.md`; it is not a contract assertion failure.

## Direct-link and deployment limitations

HTTP GET checks returned `200` with the PulseGate app shell for `/`, `/events`,
and `/how-it-works`, confirming Vercel SPA fallback delivery. The new frontend
source has not been deployed, and no in-app browser was available for rendered
visual verification. Therefore this audit does not claim that the new route or
trust-state UI is live.

## Required coordinated cutover

1. Obtain frontend production deployment access.
2. Run `scripts/deploy.ps1 -SetSupabaseSecrets` to deploy and initialize both
   current contracts, regenerate bindings, and set service IDs.
3. update production frontend environment values to the same IDs;
4. deploy this exact frontend source;
5. verify stored peer addresses and the four-argument `mark_used` spec;
6. complete purchase, refund, listing, cancellation or resale, check-in, and
   fund-release demonstrations where lifecycle timing permits;
7. capture the fixed nine-image set and refresh the walkthrough video.

Do not switch only one layer. A partial cutover would break authoritative flows.
