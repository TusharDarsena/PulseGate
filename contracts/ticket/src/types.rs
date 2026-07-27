use soroban_sdk::{contracttype, Address, String};

/// Storage keys for all persistent data in TicketContract.
/// Keyed by event_id or ticket_id (both Strings).
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Stores an Event record, keyed by event_id
    Event(String),
    /// Stores a Ticket record, keyed by ticket_id
    Ticket(String),
    /// Stores escrow balance (in stroops) for an event, keyed by event_id
    Escrow(String),
    /// The one address allowed to call restricted_transfer.
    /// Set once at initialize(), never changes.
    /// NOTE: Stored in instance() storage — not persistent() — because this IS
    /// contract-lifetime data. See docs/architecture.md D-012.
    MarketplaceAddress,
    /// The trusted XLM SAC address. Set once at initialize().
    /// Never supplied by callers — prevents fake-token escrow drain (S-001).
    XlmToken,
    /// Admin address — set once at initialize, can re-initialize after contract upgrade.
    /// Stored in instance() — contract-lifetime data.
    Admin,
}

/// Event status lifecycle.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum EventStatus {
    Active,
    Cancelled,
    Completed,
}

/// Ticket status lifecycle.
/// Kept as a three-variant enum rather than a bool so on-chain history can
/// distinguish a scanned ticket (Used) from a refunded one (Refunded).
/// Changing this after data lands on-chain requires a storage migration — do it now.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum TicketStatus {
    /// Ticket is valid and has not been used or refunded.
    Active,
    /// Ticket was scanned at the venue door via mark_used.
    Used,
    /// Ticket was refunded because the event was cancelled.
    Refunded,
}

/// Full event record stored on-chain.
#[derive(Clone)]
#[contracttype]
pub struct Event {
    /// Address that created the event and will receive funds after release
    pub organizer: Address,
    /// Short display name (stored as String to handle spaces and length > 32)
    pub name: String,
    /// Unix timestamp when primary sales close and the event starts
    pub date_unix: u64,
    /// Unix timestamp when the event ends and completion becomes eligible
    pub end_unix: u64,
    /// Maximum number of tickets that can be sold
    pub capacity: i128,
    /// Price per ticket in stroops (1 XLM = 10_000_000 stroops)
    pub price_per_ticket: i128,
    /// How many tickets have been sold so far
    pub current_supply: i128,
    pub status: EventStatus,
}

/// Individual ticket record stored on-chain.
#[derive(Clone)]
#[contracttype]
pub struct Ticket {
    /// Current owner of this ticket
    pub owner: Address,
    /// Which event this ticket belongs to
    pub event_id: String,
    /// Lifecycle state: Active → Used (scanned) or Refunded (event cancelled).
    /// Never use a bool here — on-chain data is permanent and analytics must
    /// distinguish the two terminal states. See D-018.
    pub status: TicketStatus,
}
