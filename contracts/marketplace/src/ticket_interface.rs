// Cross-contract interface for TicketContract.
//
// Uses #[contractclient] to generate a client type without linking any
// ticket contract code into the marketplace WASM — avoiding the "symbol
// multiply defined" linker error from cdylib-to-cdylib linkage.
//
// CRITICAL: struct field names AND order must exactly match ticket::types,
// since Soroban XDR encodes structs positionally. Any divergence silently
// corrupts data. Keep in sync with ticket/src/types.rs.

use soroban_sdk::{contractclient, contracttype, Address, Env, String};

#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum TicketStatus {
    Active,
    Used,
    Refunded,
}

#[derive(Clone, PartialEq, Debug)]
#[contracttype]
pub enum EventStatus {
    Active,
    Cancelled,
    Completed,
}

/// Mirror of ticket::types::Ticket — field order must match exactly.
#[derive(Clone)]
#[contracttype]
pub struct Ticket {
    pub owner: Address,
    pub event_id: String,
    pub status: TicketStatus,
}

/// Mirror of ticket::types::Event — field order must match exactly.
#[derive(Clone)]
#[contracttype]
pub struct Event {
    pub organizer: Address,
    pub name: String,
    pub date_unix: u64,
    pub end_unix: u64,
    pub capacity: i128,
    pub price_per_ticket: i128,
    pub current_supply: i128,
    pub status: EventStatus,
}

/// Generated client used by both production lib.rs and test.rs.
/// Production: makes real cross-contract calls via XDR.
/// Tests: calls into env.register(TicketContract, ()) using the same XDR encoding.
#[allow(dead_code)]
#[contractclient(name = "TicketContractClient")]
pub trait TicketInterface {
    // Called in buy_listing (production + test)
    fn get_ticket(env: Env, ticket_id: String) -> Ticket;
    fn get_event(env: Env, event_id: String) -> Event;
    fn get_xlm_token(env: Env) -> Address;
    fn restricted_transfer(env: Env, ticket_id: String, new_owner: Address);

    // Called in test setup helpers only
    fn initialize(env: Env, admin: Address, marketplace_address: Address, xlm_token: Address);
    fn create_event(
        env: Env,
        organizer: Address,
        event_id: String,
        name: String,
        date_unix: u64,
        end_unix: u64,
        capacity: i128,
        price_per_ticket: i128,
    );
    fn purchase(env: Env, event_id: String, buyer: Address, ticket_id: String);
    fn cancel_event(env: Env, event_id: String, organizer: Address);
    fn release_funds(env: Env, event_id: String, organizer: Address);
    fn mark_used(env: Env, ticket_id: String, organizer: Address);
}
