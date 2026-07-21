### Web3 Integration Audit Report: Stellar Ticketing System

#### 1\. Executive Audit Context and Strategic Importance

In a production-grade Web3 ecosystem, the integrity of the "Golden Thread"—the logical continuity from high-level architectural mandates to low-level execution—is the only guarantee of system security and maintainability. This audit evaluates the Stellar Ticketing System to ensure that the strategic specifications defined in docs/architecture.md, AGENTS.md, and plan.md are reflected with absolute precision in the implementation layers of frontend/src/lib/ and the supabase\_schema.sql database foundation.The "Ground Truth" for this investigation is comprised of:

* **Specifications** : architecture.md, AGENTS.md, and plan.md.  
* **Implementation** : soroban.ts, stellar.ts, qr.ts, constants.ts, and supabase\_schema.sql.  
* **DevOps** : deploy.sh.Any deviation between these files constitutes "architectural drift," a precursor to systemic failure. This audit begins with a rigorous verification of the ledger interaction mechanics, where the Golden Thread first meets the blockchain.

#### 2\. Transaction Building & Wallet Logic Verification

The project has transitioned to a client-side transaction orchestration model (Decision D-007 revised), utilizing AssembledTransaction to handle the build-simulate-sign-submit lifecycle within the user's browser. This is a critical security boundary intended to eliminate sequence number conflicts and centralize blockchain logic.

* **Location / Doc File** : frontend/src/lib/soroban.ts / AGENTS.md  
* **Claimed in Documentation** : AGENTS.md mandates that soroban.ts is the " **only**  file importing SorobanRpc" and that AssembledTransaction.signAndSend() must be used for all transactions.  
* **Actual Code Implementation** : While soroban.ts correctly utilizes signAndSend in functions like purchaseTicket and createEvent, it re-exports SorobanRpc and provides a getRpcServer() factory.  
* **Discrepancy & Severity** :  **Low** . While technically the only file  *importing*  the library, re-exporting the SorobanRpc namespace creates a semantic bypass of the abstraction layer, allowing other files to interact with the RPC server directly, violating the spirit of the "Hard Rule."  
* **Recommended Fix** : Remove the export { SorobanRpc } and getRpcServer re-exports. All RPC-related logic, including event polling or server instantiation, must be encapsulated strictly within the private scope of soroban.ts.

#### 3\. Burner Wallet & Authentication Logic Audit

To facilitate "crypto-less" onboarding, the system implements Burner Wallets (D-028). This implementation must adhere to strict separation of concerns to prevent low-level cryptographic logic from leaking into high-level wallet management.

* **Location / Doc File** : frontend/src/lib/stellar.ts / AGENTS.md  
* **Claimed in Documentation** : "No transaction building here—that lives in soroban.ts." (AGENTS.md).  
* **Actual Code Implementation** : The buildBurnerSignFn in stellar.ts imports TransactionBuilder and performs tx.sign(keypair).  
* **Discrepancy & Severity** :  **Medium** . This is a direct boundary violation. stellar.ts is performing low-level transaction manipulation (building from XDR and signing) which was explicitly restricted to soroban.ts. Additionally, the SignFn return type was updated to { signedTxXdr: string }, which is implemented, but the location of the logic is incorrect.  
* **Recommended Fix** : Migrate buildBurnerSignFn and any logic involving TransactionBuilder to soroban.ts. stellar.ts should be restricted to keypair generation (Keypair.random()) and identity verification (Keypair.verify()).

#### 4\. QR Code Format & Cryptographic Verification

The rotating QR code protocol is the system's primary defense against replay attacks and must support zero-network-call verification for gate entry efficiency.

* **Location / Doc File** : frontend/src/lib/qr.ts / docs/architecture.md  
* **Claimed in Documentation** : "The venue scanner... Rejects if |now \- timestamp| \> 30s." (architecture.md, D-006).  
* **Actual Code Implementation** : qr.ts defines PAYLOAD\_EXPIRY\_SECONDS \= 45\. The code includes a comment attempting to justify a "15-second grace period" for clock drift.  
* **Discrepancy & Severity** :  **Medium** . This is an unauthorized 50% increase in the attack window. An auditor does not accept "grace periods" that contradict signed architectural specifications.  
* **Recommended Fix** : Revert PAYLOAD\_EXPIRY\_SECONDS to 30\. Clock drift should be handled via device synchronization (NTP) rather than widening security-sensitive cryptographic windows.

#### 5\. Environment Configuration & Address Management

Centralized configuration is the only defense against "deployment drift," where different environments (Testnet vs. Mainnet) lead to hardcoded inconsistencies.

1. **Location / Doc File** : constants.ts / deploy.sh / AGENTS.md  
2. **Claimed in Documentation** : "lib/constants.ts... The  **only**  place. Hardcoding elsewhere is a bug." Additionally, constants.ts must read from import.meta.env  **only** .  
3. **Actual Code Implementation** :  
4. scripts/deploy.sh hardcodes the Testnet XLM address: XLM\_TESTNET="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC".  
5. constants.ts hardcodes FRIENDBOT\_URL \= 'https://friendbot.stellar.org'.  
6. **Discrepancy & Severity** :  **Medium** . These are direct violations of "Hard Rules." Hardcoding the XLM address in the deployment pipeline creates a precedent for breaking the centralized configuration mandate. Hardcoding Friendbot in constants.ts violates the "env only" rule.  
7. **Recommended Fix** :  
8. Move the XLM\_TESTNET address into a .env variable and have deploy.sh reference it.  
9. Move FRIENDBOT\_URL to the .env pipeline and access it via import.meta.env.VITE\_FRIENDBOT\_URL.

#### 6\. Database Schema & Deployment Alignment Audit

Per plan.md, Supabase serves as the "Read Index." The SQL schema must perfectly support the metadata requirements for event discovery to avoid slow on-chain RPC scans.

* **Location / Doc File** : supabase\_schema.sql / plan.md / frontend/src/contracts/ticket/src/index.ts  
* **Claimed in Documentation** : The events table must include description, image\_url, venue, city, and category (plan.md).  
* **Actual Code Implementation** : supabase\_schema.sql is missing all five metadata columns. Furthermore, the schema defines current\_supply as an integer, while the contract bindings (index.ts) define it as i128.  
* **Discrepancy & Severity** :  **High** . The missing columns break the discovery strategy. The type mismatch (integer vs i128) creates a potential overflow risk during database synchronization if on-chain supply exceeds 2.1 billion—a theoretical but unacceptable architectural inconsistency.  
* **Recommended Fix** : Execute the following ALTER TABLE commands to synchronize with the engineering plan and fix type mismatches:

#### 7\. Summary of Audit Findings & Risk Matrix

Category,Primary Discrepancy,Overall Risk Level  
Transaction Orchestration,Abstraction leak via SorobanRpc re-exports in soroban.ts.,Low  
Authentication & Wallet,Boundary violation: stellar.ts performing low-level tx signing.,Medium  
QR Verification,Unauthorized 15s window expansion (45s vs 30s spec).,Medium  
Address Management,Hardcoded XLM address in deploy.sh and Friendbot URL in constants.ts.,Medium  
Database Schema,Missing metadata columns and supply type overflow risk.,High  
The system demonstrates significant "architectural drift" in its database schema and configuration management. These issues must be remediated before the system can be considered integrated and ready for production deployment.  
