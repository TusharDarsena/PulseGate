use soroban_sdk::{contracttype, Address, String};

/// Storage keys for all data in MarketplaceContract.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// Listing record, keyed by (seller, listing_id).
    /// Namespaced to seller so no third party can block a seller's chosen ID
    /// by front-running with the same listing_id.
    Listing(Address, String),
    /// TicketContract address — set once at initialize, stored in instance().
    TicketContract,
    /// Royalty rate as integer percentage [0, 100] — set once at initialize,
    /// stored in instance(). See docs/architecture.md D-010.
    RoyaltyRate,
    /// Admin address — set once at initialize, can re-initialize after contract upgrade.
    Admin,
}

/// Listing lifecycle.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum ListingStatus {
    Open,
    Sold,
    Cancelled,
}

/// Event status — mirrors ticket::types::EventStatus for cross-contract calls.
#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum EventStatus {
    Active,
    Cancelled,
    Completed,
}

/// A secondary-market listing record stored on-chain.
#[derive(Clone)]
#[contracttype]
pub struct Listing {
    pub seller: Address,
    pub ticket_id: String,
    /// Stored for informational / frontend purposes only.
    /// buy_listing derives the authoritative event_id from the on-chain
    /// ticket record to prevent seller-supplied event_id forgery.
    pub event_id: String,
    pub ask_price: i128,
    pub status: ListingStatus,
}
