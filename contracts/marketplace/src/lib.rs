#![no_std]

mod error;
mod events;
mod storage;
mod ticket_interface;
mod types;

#[cfg(test)]
mod test;

use crate::ticket_interface::TicketContractClient;
use soroban_sdk::{contract, contractimpl, token, Address, Env, String};

use crate::error::ContractError;
use crate::ticket_interface::EventStatus;
use crate::types::{Listing, ListingStatus};

#[contract]
pub struct MarketplaceContract;

#[contractimpl]
impl MarketplaceContract {
    // -----------------------------------------------------------------------
    // Initialization
    // -----------------------------------------------------------------------

    /// Set the TicketContract address and the royalty rate (integer percentage).
    /// Rate is clamped to [0, 100]. Can only be called once.
    /// Admin is authenticated to prevent front-running.
    pub fn initialize(
        env: Env,
        admin: Address,
        ticket_contract_address: Address,
        royalty_rate: i128,
    ) -> Result<(), ContractError> {
        admin.require_auth();

        if storage::has_admin(&env) {
            return Err(ContractError::AlreadyInitialized);
        }
        storage::write_admin(&env, &admin);
        storage::write_ticket_contract(&env, &ticket_contract_address);
        // Clamp rate to [0, 100] — prevents invalid percentage at storage time.
        let clamped_rate = royalty_rate.max(0).min(100);
        storage::write_royalty_rate(&env, clamped_rate);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Listing
    // -----------------------------------------------------------------------

    /// Create a listing. `listing_id` is seller-namespaced in storage so no
    /// third party can block a seller's chosen ID by front-running.
    /// No on-chain ticket lock — see D-009. Stale listings fail fast in buy_listing.
    pub fn list_ticket(
        env: Env,
        seller: Address,
        listing_id: String,
        ticket_id: String,
        event_id: String,
        ask_price: i128,
    ) -> Result<(), ContractError> {
        seller.require_auth();

        if storage::has_listing(&env, &seller, &listing_id) {
            return Err(ContractError::ListingAlreadyExists);
        }
        if ask_price <= 0 {
            return Err(ContractError::InvalidPrice);
        }

        let listing = Listing {
            seller: seller.clone(),
            ticket_id,
            event_id,
            ask_price,
            status: ListingStatus::Open,
        };
        storage::write_listing(&env, &seller, &listing_id, &listing);
        events::emit_listed(&env, &listing_id, &seller, ask_price);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Buy
    // -----------------------------------------------------------------------

    /// Purchase a listing. Pays royalty to the event organizer (derived from
    /// the on-chain ticket record — never from the seller-supplied event_id),
    /// remainder to seller, then calls restricted_transfer to move the ticket.
    ///
    /// CEI order: all reads → compute → state write → token interactions → restricted_transfer.
    pub fn buy_listing(
        env: Env,
        seller: Address,
        listing_id: String,
        buyer: Address,
    ) -> Result<(), ContractError> {
        buyer.require_auth();

        let listing = storage::read_listing(&env, &seller, &listing_id)?;

        if listing.status != ListingStatus::Open {
            return Err(ContractError::ListingNotOpen);
        }
        if buyer == listing.seller {
            return Err(ContractError::BuyerIsSeller);
        }

        // --- READ PHASE (before any state writes or token interactions) ---

        let ticket_contract_addr = storage::read_ticket_contract(&env)?;
        let ticket_client = TicketContractClient::new(&env, &ticket_contract_addr);

        // Derive the true event_id from the on-chain ticket record.
        // This prevents a malicious seller from supplying a fake event_id at
        // list time to redirect royalties to themselves.
        let ticket = ticket_client.get_ticket(&listing.ticket_id);
        let true_event_id = ticket.event_id;

        // Fail fast: if the seller no longer owns the ticket (stale listing),
        // abort before touching any XLM. Full rollback happens on panic anyway,
        // but this avoids paying gas for all token cross-contract calls (D-009).
        if ticket.owner != listing.seller {
            return Err(ContractError::TicketOwnerMismatch);
        }

        // Authoritative organizer comes from the on-chain event record.
        let event = ticket_client.get_event(&true_event_id);
        let organizer = event.organizer;

        // Secondary sales are valid only while the authoritative event is Active.
        // This prevents resale after cancellation or completion.
        if event.status != EventStatus::Active {
            return Err(ContractError::EventNotActive);
        }

        // XLM token address from the trusted ticket contract storage (S-001).
        let xlm_token = ticket_client.get_xlm_token();

        let rate = storage::read_royalty_rate(&env)?;
        let ask_price = listing.ask_price;

        // Ceiling division: (price * rate + 99) / 100
        // Prevents micro-transaction royalty evasion via floor division.
        // Pattern adopted from litemint-royalty-contract. See D-010.
        let royalty = ask_price
            .checked_mul(rate)
            .ok_or(ContractError::Overflow)?
            .checked_add(99)
            .ok_or(ContractError::Overflow)?
            .checked_div(100)
            .ok_or(ContractError::DivisionByZero)?;

        let seller_proceeds = ask_price
            .checked_sub(royalty)
            .ok_or(ContractError::Underflow)?;

        // --- EFFECT: state write before external interactions (CEI, S-003) ---
        let mut updated_listing = listing.clone();
        updated_listing.status = ListingStatus::Sold;
        storage::write_listing(&env, &seller, &listing_id, &updated_listing);

        // --- INTERACT: token transfers then restricted_transfer ---
        let token_client = token::Client::new(&env, &xlm_token);

        // 1. Pull full ask_price from buyer into this contract.
        // Guard: skip if 0 — token SAC panics on 0 transfer.
        if ask_price > 0 {
            token_client.transfer(&buyer, &env.current_contract_address(), &ask_price);
        }

        // 2. Push royalty to organizer (guard: skip if 0 — token SAC panics on 0 transfer).
        if royalty > 0 {
            token_client.transfer(&env.current_contract_address(), &organizer, &royalty);
        }

        // 3. Push seller proceeds (guard: skip if 0 — token SAC panics on 0 transfer).
        if seller_proceeds > 0 {
            token_client.transfer(&env.current_contract_address(), &seller, &seller_proceeds);
        }

        // 4. Transfer ticket ownership via TicketContract's gated function.
        //    restricted_transfer uses marketplace.require_auth() — satisfied by
        //    this contract being the caller. No buyer auth needed here.
        ticket_client.restricted_transfer(&listing.ticket_id, &buyer);

        events::emit_sold(&env, &listing_id, &buyer, ask_price);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Cancel
    // -----------------------------------------------------------------------

    /// Cancel an Open listing. Only the original seller can cancel.
    pub fn cancel_listing(
        env: Env,
        seller: Address,
        listing_id: String,
    ) -> Result<(), ContractError> {
        seller.require_auth();

        let mut listing = storage::read_listing(&env, &seller, &listing_id)?;

        if listing.status != ListingStatus::Open {
            return Err(ContractError::ListingNotOpen);
        }

        listing.status = ListingStatus::Cancelled;
        storage::write_listing(&env, &seller, &listing_id, &listing);
        events::emit_cancelled(&env, &listing_id, &seller);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Read-only queries
    // -----------------------------------------------------------------------

    pub fn get_listing(
        env: Env,
        seller: Address,
        listing_id: String,
    ) -> Result<Listing, ContractError> {
        storage::read_listing(&env, &seller, &listing_id)
    }
}
