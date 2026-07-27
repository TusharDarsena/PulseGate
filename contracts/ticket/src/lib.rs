#![no_std]

mod error;
mod escrow;
mod events;
mod storage;
mod types;

#[cfg(test)]
mod test;

use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::error::ContractError;
use crate::types::{Event, EventStatus, Ticket, TicketStatus};

#[contract]
pub struct TicketContract;

#[contractimpl]
impl TicketContract {
    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// Set the one marketplace address allowed to call restricted_transfer,
    /// and the trusted XLM SAC token address.
    /// Can only be called once. Admin is authenticated to prevent front-running.
    pub fn initialize(
        env: Env,
        admin: Address,
        marketplace_address: Address,
        xlm_token: Address,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        if storage::has_admin(&env) {
            return Err(ContractError::AlreadyInitialized);
        }
        storage::write_admin(&env, &admin);
        storage::write_marketplace_address(&env, &marketplace_address);
        // Store the trusted XLM token once — callers never supply it again (S-001).
        storage::write_xlm_token(&env, &xlm_token);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Event management
    // -----------------------------------------------------------------------

    /// Create a new event. Does NOT mint tickets — lazy minting at purchase time.
    pub fn create_event(
        env: Env,
        organizer: Address,
        event_id: String,
        name: String,
        date_unix: u64,
        end_unix: u64,
        capacity: i128,
        price_per_ticket: i128,
    ) -> Result<(), ContractError> {
        organizer.require_auth();

        if storage::has_event(&env, &event_id) {
            return Err(ContractError::EventAlreadyExists);
        }
        // Validate inputs — zero/negative values produce economically broken events.
        if capacity <= 0 {
            return Err(ContractError::InvalidCapacity);
        }
        if price_per_ticket <= 0 {
            return Err(ContractError::InvalidPrice);
        }
        if date_unix <= env.ledger().timestamp() {
            return Err(ContractError::EventDateInPast);
        }
        if end_unix <= date_unix {
            return Err(ContractError::InvalidEventEndTime);
        }

        let event = Event {
            organizer: organizer.clone(),
            name,
            date_unix,
            end_unix,
            capacity,
            price_per_ticket,
            current_supply: 0,
            status: EventStatus::Active,
        };

        storage::write_event(&env, &event_id, &event);
        events::emit_event_created(&env, &event_id, &organizer);
        Ok(())
    }

    /// Cancel event. Only organizer. Does not auto-refund — pull-based per D-002.
    pub fn cancel_event(
        env: Env,
        event_id: String,
        organizer: Address,
    ) -> Result<(), ContractError> {
        organizer.require_auth();

        let mut event = storage::read_event(&env, &event_id)?;

        if event.organizer != organizer {
            return Err(ContractError::OnlyOrganizerAllowed);
        }
        if event.status != EventStatus::Active {
            return match event.status {
                EventStatus::Completed => Err(ContractError::EventAlreadyCompleted),
                _ => Err(ContractError::EventNotActive),
            };
        }

        event.status = EventStatus::Cancelled;
        storage::write_event(&env, &event_id, &event);
        events::emit_event_cancelled(&env, &event_id, &organizer);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Ticket purchase
    // -----------------------------------------------------------------------

    /// Purchase a ticket. Pulls price_per_ticket XLM from buyer into escrow.
    /// Token address is read from contract storage — never trusted from caller (S-001).
    pub fn purchase(
        env: Env,
        event_id: String,
        buyer: Address,
        ticket_id: String,
    ) -> Result<(), ContractError> {
        buyer.require_auth();

        // Reject duplicate ticket IDs — overwriting an existing ticket loses ownership (#1).
        if storage::has_ticket(&env, &ticket_id) {
            return Err(ContractError::TicketAlreadyExists);
        }

        let mut event = storage::read_event(&env, &event_id)?;

        if event.status != EventStatus::Active {
            return Err(ContractError::EventNotActive);
        }
        // Primary sales close at the event start. This authoritative guard must
        // run before ticket, supply, escrow, or token effects.
        if env.ledger().timestamp() >= event.date_unix {
            return Err(ContractError::EventSalesClosed);
        }
        if event.current_supply >= event.capacity {
            return Err(ContractError::EventCapacityExceeded);
        }

        // --- CEI: all state writes BEFORE external call (S-003) ---

        // Mint ticket (lazy — only on purchase)
        let ticket = Ticket {
            owner: buyer.clone(),
            event_id: event_id.clone(),
            status: TicketStatus::Active,
        };
        storage::write_ticket(&env, &ticket_id, &ticket);

        // Update supply and escrow accounting
        event.current_supply = event
            .current_supply
            .checked_add(1)
            .ok_or(ContractError::Overflow)?;
        storage::write_event(&env, &event_id, &event);
        escrow::add_to_escrow(&env, &event_id, event.price_per_ticket)?;

        // External interaction last — pull XLM from buyer into escrow.
        let xlm_token = storage::read_xlm_token(&env)?;
        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(
            &buyer,
            &env.current_contract_address(),
            &event.price_per_ticket,
        );

        events::emit_ticket_purchased(&env, &ticket_id, &buyer, &event_id);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Escrow release
    // -----------------------------------------------------------------------

    /// Complete the event and release escrowed funds to organizer.
    /// Only callable at or after the authoritative event end time.
    /// Token address is read from contract storage — never trusted from caller (S-001).
    pub fn release_funds(
        env: Env,
        event_id: String,
        organizer: Address,
    ) -> Result<(), ContractError> {
        organizer.require_auth();

        let mut event = storage::read_event(&env, &event_id)?;

        if event.organizer != organizer {
            return Err(ContractError::OnlyOrganizerAllowed);
        }
        if event.status != EventStatus::Active {
            return match event.status {
                EventStatus::Completed => Err(ContractError::EventAlreadyCompleted),
                _ => Err(ContractError::EventNotActive),
            };
        }
        if env.ledger().timestamp() < event.end_unix {
            return Err(ContractError::EventNotEligibleForRelease);
        }

        let held = escrow::get_escrow_balance(&env, &event_id);

        // State updates before any external transfer (CEI).
        if held > 0 {
            escrow::subtract_from_escrow(&env, &event_id, held)?;
        }
        event.status = EventStatus::Completed;
        storage::write_event(&env, &event_id, &event);

        // The SAC rejects zero-value transfers. A zero-sale event still
        // completes authoritatively and emits ev_rel with amount 0.
        if held > 0 {
            let xlm_token = storage::read_xlm_token(&env)?;
            let token_client = token::Client::new(&env, &xlm_token);
            token_client.transfer(&env.current_contract_address(), &organizer, &held);
        }

        events::emit_funds_released(&env, &event_id, &organizer, held);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Refund (pull-based, only when event is Cancelled — see D-002)
    // -----------------------------------------------------------------------

    pub fn refund(env: Env, ticket_id: String, attendee: Address) -> Result<(), ContractError> {
        attendee.require_auth();

        let mut ticket = storage::read_ticket(&env, &ticket_id)?;

        if ticket.owner != attendee {
            return Err(ContractError::TicketNotOwnedByCaller);
        }
        if ticket.status != TicketStatus::Active {
            return Err(ContractError::TicketAlreadyUsed);
        }

        let event = storage::read_event(&env, &ticket.event_id)?;

        if event.status != EventStatus::Cancelled {
            return Err(ContractError::EventNotCancelled);
        }

        // State updates before external transfer (CEI).
        // Mark ticket Refunded — distinct from Used (scanned). See D-018.
        ticket.status = TicketStatus::Refunded;
        storage::write_ticket(&env, &ticket_id, &ticket);
        escrow::subtract_from_escrow(&env, &ticket.event_id, event.price_per_ticket)?;

        // Return price to attendee using the stored trusted token address.
        let xlm_token = storage::read_xlm_token(&env)?;
        let token_client = token::Client::new(&env, &xlm_token);
        token_client.transfer(
            &env.current_contract_address(),
            &attendee,
            &event.price_per_ticket,
        );

        events::emit_refund(&env, &ticket_id, &attendee, event.price_per_ticket);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Restricted transfer (only callable by marketplace — see D-003, D-009)
    // -----------------------------------------------------------------------

    /// Transfer ticket ownership. ONLY the stored marketplace address can call this.
    pub fn restricted_transfer(
        env: Env,
        ticket_id: String,
        new_owner: Address,
    ) -> Result<(), ContractError> {
        let marketplace = storage::read_marketplace_address(&env)?;
        marketplace.require_auth();

        let mut ticket = storage::read_ticket(&env, &ticket_id)?;

        if ticket.status != TicketStatus::Active {
            return Err(ContractError::TicketAlreadyUsed);
        }

        ticket.owner = new_owner.clone();
        storage::write_ticket(&env, &ticket_id, &ticket);

        events::emit_restricted_transfer(&env, &ticket_id, &new_owner);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Mark used (at venue door after QR verification — see architecture.md QR section)
    // -----------------------------------------------------------------------

    pub fn mark_used(env: Env, ticket_id: String, organizer: Address) -> Result<(), ContractError> {
        organizer.require_auth();

        let mut ticket = storage::read_ticket(&env, &ticket_id)?;

        if ticket.status != TicketStatus::Active {
            return Err(ContractError::TicketAlreadyUsed);
        }

        let event = storage::read_event(&env, &ticket.event_id)?;
        if event.organizer != organizer {
            return Err(ContractError::OnlyOrganizerAllowed);
        }
        if event.status != EventStatus::Active {
            return Err(ContractError::EventNotActive);
        }

        // Mark ticket Used — distinct from Refunded. See D-018.
        ticket.status = TicketStatus::Used;
        storage::write_ticket(&env, &ticket_id, &ticket);

        events::emit_ticket_used(&env, &ticket_id);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read-only queries
    // -----------------------------------------------------------------------

    pub fn get_ticket(env: Env, ticket_id: String) -> Result<Ticket, ContractError> {
        storage::read_ticket(&env, &ticket_id)
    }

    pub fn get_event(env: Env, event_id: String) -> Result<Event, ContractError> {
        storage::read_event(&env, &event_id)
    }

    /// Return the actual XLM escrow held for an existing event.
    pub fn get_escrow_balance(env: Env, event_id: String) -> Result<i128, ContractError> {
        // Escrow defaults to zero internally, so prove the event exists first
        // rather than making a missing event indistinguishable from no sales.
        storage::read_event(&env, &event_id)?;
        Ok(escrow::get_escrow_balance(&env, &event_id))
    }

    pub fn get_marketplace(env: Env) -> Result<Address, ContractError> {
        storage::read_marketplace_address(&env)
    }

    /// Return the trusted XLM SAC token address stored at initialize.
    /// Useful for frontend transparency and test assertions.
    pub fn get_xlm_token(env: Env) -> Result<Address, ContractError> {
        storage::read_xlm_token(&env)
    }
}
