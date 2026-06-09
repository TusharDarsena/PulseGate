### Technical Discrepancy Report: Stellar Ticketing Frontend Implementation vs. Architectural Specifications

##### 1\. Audit Mandate and Methodology

In the lifecycle of a decentralized application, documentation-to-code parity is not merely a preference but a critical technical requirement for security, maintainability, and architectural integrity. As the Senior Lead Frontend Architect, I have performed a comprehensive audit to identify "architectural drift"—the divergence between our binding technical specifications and the actual React/TypeScript implementation. This report focuses on the synchronization between the frontend discovery layer and the Soroban smart contract logic, where unaligned state management or stale feature claims directly threaten the reliability of the Stellar integration.**Scope of Analysis**  The following "ground truth" documents were utilized as the baseline for this audit:

* architecture.md: Binding design for storage, functions, and state management.  
* decisions.md: Official log of architectural choices (D-001 through D-034).  
* plan.md: The multi-phase technical remediation roadmap.  
* README.md: Public-facing feature claims and project status.  
* AGENTS.md: File ownership and development protocols.The audit involved a line-by-line inspection of the frontend/src/ directory, specifically focusing on global stores, hooks, and page-level logic in App.tsx, MyTicketsPage.tsx, and DashboardPage.tsx.

##### 2\. State Management and Routing Architecture

Document docs/architecture.md (D-025) mandates the centralization of state within a Zustand store to eliminate prop-drilling and provide immediate transaction feedback across the application. This is a strategic necessity for handling asynchronous Soroban transaction simulations.**Audit: Global vs. Local State**

* **Location / Doc File:**  docs/architecture.md (D-025) / frontend/src/App.tsx  
* **Claimed in Documentation:**  "txState and wallet are managed in a central store (useAppStore). This ensures that transaction feedback... and wallet updates are reflected immediately across the entire application without prop-drilling."  
* **Actual Code Implementation:**  While txState and wallet are centralized, the core routing and context state—specifically currentView, selectedEventId, and selectedTicketId—remain trapped as local useState hooks within App.tsx.  
* **Discrepancy & Severity:**   **High.**  This violates the centralized state architecture. Siloing navigation state in App.tsx prevents other components from programmatically triggering navigation or context-aware updates (e.g., redirecting after a successful purchase or scan), breaking the intended decoupling.  
* **Recommended Fix:**  Migrate currentView, selectedEventId, and selectedTicketId to the AppState interface in useAppStore.ts. Critically, these variables must be  **excluded**  from the Zustand persist middleware to prevent "stuck" UI states on browser refreshes, while allowing global access for programmatic navigation.

##### 3\. Feature Parity Audit: The "Deferred" Feature Conflict

A professional technical implementation requires absolute clarity regarding MVP scope. Currently, the technical documentation is in direct conflict with itself. plan.md Phase 4 explicitly mandates building UI for Marketplace and Refunds, while docs/decisions.md (D-032/D-033) explicitly defers them to Post-MVP. This internal documentation conflict has led to a fragmented and non-compliant code implementation.**Audit: Marketplace Resale**

* **Location / Doc File:**  docs/decisions.md (D-032) vs. frontend/src/pages/MarketplacePage.tsx  
* **Claimed in Documentation:**  D-032 states "no frontend UI will be built for resale flows in the MVP."  
* **Actual Code Implementation:**  A fully realized MarketplacePage.tsx exists, utilizing useListings and handleBuy logic.  
* **Discrepancy & Severity:**   **High.**  This is a compliance failure. Building UI for a deferred feature increases the maintenance surface area and implies a "finished" state for logic that may not be fully stress-tested.  
* **Recommended Fix:**  Remove or gate the Marketplace UI behind a feature flag and update plan.md to align with the Decision Log.**Audit: Event Cancellation**  
* **Location / Doc File:**  docs/decisions.md (D-033) vs. frontend/src/pages/organizer/DashboardPage.tsx  
* **Claimed in Documentation:**  D-033 states "Organizers cannot cancel events from the dashboard in MVP."  
* **Actual Code Implementation:**  DashboardPage.tsx contains a handleCancel function and provides an onCancel prop to OrganizerEventRow.  
* **Discrepancy & Severity:**   **High.**  The presence of "ghost" cancellation logic contradicts the explicit deferment in the Decision Log, creating a risk where organizers may attempt to cancel events without the required pull-based refund support being active in the attendee UI.  
* **Recommended Fix:**  Strip the handleCancel logic from the organizer dashboard to enforce the Post-MVP deferment.**Audit: Ticket Refunds**  
* **Location / Doc File:**  docs/decisions.md (D-033) vs. frontend/src/pages/MyTicketsPage.tsx  
* **Claimed in Documentation:**  D-033 states "Attendees cannot self-serve refunds."  
* **Actual Code Implementation:**  MyTicketsPage.tsx implements handleRefund and passes it to the TicketCard component.  
* **Discrepancy & Severity:**   **High.**  This represents a "Stale Feature Claim" in the code. Providing a refund button for a feature officially deferred risks user confusion and potential support overhead for a non-functional or unverified flow.  
* **Recommended Fix:**  Remove the refund UI elements from MyTicketsPage.tsx until Phase 2 of development.

##### 4\. Data Flow Audit: Supabase Integration vs. RPC Discovery

The "Supabase-as-Read-Index" principle defined in plan.md is intended to eliminate RPC event scanning as a primary discovery mechanism to ensure performance and scalability.**Audit: Data Fetching and Discovery**

* **Location / Doc File:**  plan.md Phase 0 / CHANGELOG.md Session 8  
* **Claimed in Documentation:**  "RPC event scanning is eliminated as a primary discovery mechanism." All discovery must happen via Supabase queries.  
* **Actual Code Implementation:**  useEvents.ts and useTickets.ts call Supabase as requested. However, CHANGELOG.md Session 8 explicitly mentions fixes for "RPC topic filters" to support these same hooks.  
* **Discrepancy & Severity:**   **Medium.**  This suggests a hybridized or incomplete transition. The hooks may still be relying on expensive RPC scans as a fallback, violating the performance mandate of the Supabase-only indexer model.  
* **Recommended Fix:**  Audit useEvents.ts and useTickets.ts to ensure all SorobanRpc.getEvents logic is removed, enforcing strict reliance on the Supabase Read Index.

##### 5\. Static Analysis: Hardcoded Strings and Metadata Consistency

To provide a production-ready "Crypto-less" experience, plan.md Phase 3 mandates the removal of all hardcoded strings in favor of dynamic metadata and real-time pricing.**Audit: Hardcoded vs. Dynamic Metadata (Attendee)**

* **Location / Doc File:**  plan.md Phase 3 / frontend/src/pages/PurchasePage.tsx  
* **Claimed in Documentation:**  Removal of hardcoded values like "Crypto Arena" and "$15.20."  
* **Actual Code Implementation:**  The implementation is compliant. PurchasePage.tsx correctly utilizes event.venue, event.city, and the useXlmPrice hook to calculate the USD total.  
* **Discrepancy & Severity:**   **Low.**  No action required for this page.**Audit: Hardcoded vs. Dynamic Metadata (Organizer)**  
* **Location / Doc File:**  plan.md Phase 3 / frontend/src/pages/organizer/DashboardPage.tsx  
* **Claimed in Documentation:**  Mandate to eliminate static artifacts and hardcoded text in favor of dynamic UI.  
* **Actual Code Implementation:**  The DashboardPage.tsx contains significant hardcoded strings: "Manage your stellar event inventory and settlements" and the onboarding text "Connect your Freighter wallet to manage events...".  
* **Discrepancy & Severity:**   **Medium.**  These static strings violate the "Dynamic UI" principle. Furthermore, they represent a lack of UI professionalism in the organizer hub compared to the attendee flow.  
* **Recommended Fix:**  Move these strings to a centralized localization or configuration file, or derive header content from the organizer's profile state.

##### 6\. Remediation Roadmap and Priority Matrix

The current implementation suffers from significant architectural drift, primarily driven by conflicting internal documentation and the premature implementation of deferred features. Immediate remediation is required to restore auditor confidence.

###### *High-Priority Documentation/Code Alignment*

Discrepancy,Severity,Impact on Auditor Confidence,Immediate Next Step  
Ghost Feature Implementation,High,Violates Single Source of Truth; introduces untested financial flows (Refunds/Marketplace).,Strip handleRefund and MarketplacePage logic to align with decisions.md.  
Routing State Localization,Medium,Breaks Encapsulation; prevents global navigation triggers across the dApp.,Move currentView and selectedEventId to useAppStore (non-persisted).  
Hybrid Discovery Mechanism,Medium,"Violates ""Supabase-as-Read-Index"" principle; risks RPC rate-limiting.",Remove legacy RPC topic filter logic from useEvents and useTickets.  
Hardcoded Dashboard Strings,Medium,Degrades UI professionalism and architectural consistency.,Refactor DashboardPage.tsx headers into dynamic components.  
Internal Doc Conflict,High,Leads to developer confusion and inconsistent feature delivery.,Harmonize plan.md Phase 4 and decisions.md D-032/033 immediately.  
This roadmap provides a definitive path to technical compliance. The Lead Frontend Engineer must prioritize the removal of deferred features to ensure the MVP remains a stable, focused representation of our core smart contract integration.  
