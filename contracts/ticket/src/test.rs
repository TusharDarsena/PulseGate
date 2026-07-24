#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env, String, Symbol,
};
use token::Client as TokenClient;
use token::StellarAssetClient as TokenAdminClient;

use crate::error::ContractError;
use crate::types::TicketStatus;
use crate::{TicketContract, TicketContractClient};

// ---------------------------------------------------------------------------
// Test fixture — eliminates the 14-line boilerplate repeated in every test
// ---------------------------------------------------------------------------

struct TestSetup<'a> {
    env: Env,
    admin: Address,
    organizer: Address,
    buyer: Address,
    buyer2: Address,
    marketplace: Address,
    xlm: TokenClient<'a>,
    contract: TicketContractClient<'a>,
}

impl<'a> TestSetup<'a> {
    const PRICE: i128 = 10_000_000; // 1 XLM in stroops

    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let organizer = Address::generate(&env);
        let buyer = Address::generate(&env);
        let buyer2 = Address::generate(&env);
        let marketplace = Address::generate(&env);

        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let xlm = TokenClient::new(&env, &sac.address());
        let xlm_admin = TokenAdminClient::new(&env, &sac.address());

        // Pre-fund buyers with enough XLM for several purchases
        xlm_admin.mint(&buyer, &(Self::PRICE * 10));
        xlm_admin.mint(&buyer2, &(Self::PRICE * 10));

        let contract = TicketContractClient::new(&env, &env.register(TicketContract, ()));
        contract.initialize(&admin, &marketplace, &xlm.address);

        Self {
            env,
            admin,
            organizer,
            buyer,
            buyer2,
            marketplace,
            xlm,
            contract,
        }
    }

    /// Create a standard event at timestamp + 86400 with the given capacity.
    fn create_event(&self, event_id: &String, capacity: i128) {
        self.contract.create_event(
            &self.organizer,
            event_id,
            &String::from_str(&self.env, "TestEvent"),
            &(self.env.ledger().timestamp() + 86400),
            &capacity,
            &Self::PRICE,
        );
    }

    /// Buy a ticket as the primary buyer.
    fn purchase(&self, event_id: &String, ticket_id: &String) {
        self.contract.purchase(event_id, &self.buyer, ticket_id);
    }

    fn str(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    fn sym(&self, s: &str) -> Symbol {
        Symbol::new(&self.env, s)
    }
}

// ---------------------------------------------------------------------------
// Helper: assert that a try_* call fails with a specific ContractError variant.
//
// Soroban's generated try_* methods return:
//   Result<Result<T, ConversionError>, Result<ContractError, InvokeError>>
//
// A contract-level error returned via ContractError lands as Err(Ok(e)).
// ---------------------------------------------------------------------------
fn assert_err<T: core::fmt::Debug>(
    result: Result<
        Result<T, soroban_sdk::ConversionError>,
        Result<ContractError, soroban_sdk::InvokeError>,
    >,
    expected: ContractError,
) {
    match result {
        Err(Ok(e)) => assert_eq!(e, expected, "wrong error variant"),
        other => panic!("expected Err(Ok({expected:?})), got: {other:?}"),
    }
}

// ===========================================================================
// Happy-path tests
// ===========================================================================

#[test]
fn test_create_event_and_purchase() {
    let s = TestSetup::new();
    let event_id = s.str("ev1");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 100);
    s.purchase(&event_id, &ticket_id);

    let ticket = s.contract.get_ticket(&ticket_id);
    assert_eq!(ticket.owner, s.buyer);
    assert_eq!(ticket.status, TicketStatus::Active);

    let event = s.contract.get_event(&event_id);
    assert_eq!(event.current_supply, 1);

    // Contract holds the XLM in escrow
    assert_eq!(s.xlm.balance(&s.contract.address), TestSetup::PRICE);

    // Transparency query: get_xlm_token returns the stored SAC address
    assert_eq!(s.contract.get_xlm_token(), s.xlm.address);
    assert_eq!(s.contract.get_marketplace(), s.marketplace);
}

#[test]
fn test_capacity_enforced() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cap");

    // Create with capacity 1
    s.create_event(&event_id, 1);
    s.purchase(&event_id, &s.str("t1"));

    // Second buyer cannot purchase — capacity exceeded
    let result = s.contract.try_purchase(&event_id, &s.buyer2, &s.str("t2"));
    assert_err(result, ContractError::EventCapacityExceeded);
}

#[test]
fn test_purchase_closes_at_event_start() {
    let s = TestSetup::new();
    let before_event_id = s.str("ev_before");
    let at_event_id = s.str("ev_at");
    let after_event_id = s.str("ev_after");
    let start = s.env.ledger().timestamp() + 100;

    for event_id in [&before_event_id, &at_event_id, &after_event_id] {
        s.contract.create_event(
            &s.organizer,
            event_id,
            &s.str("TimedEvent"),
            &start,
            &10,
            &TestSetup::PRICE,
        );
    }

    s.env.ledger().set_timestamp(start - 1);
    s.purchase(&before_event_id, &s.str("t_before"));

    s.env.ledger().set_timestamp(start);
    assert_err(
        s.contract
            .try_purchase(&at_event_id, &s.buyer2, &s.str("t_at")),
        ContractError::EventSalesClosed,
    );

    s.env.ledger().set_timestamp(start + 1);
    assert_err(
        s.contract
            .try_purchase(&after_event_id, &s.buyer2, &s.str("t_after")),
        ContractError::EventSalesClosed,
    );

    assert_eq!(s.contract.get_event(&at_event_id).current_supply, 0);
    assert_eq!(s.contract.get_event(&after_event_id).current_supply, 0);
    assert_eq!(s.xlm.balance(&s.contract.address), TestSetup::PRICE);
}

#[test]
fn test_release_funds_requires_past_event_date() {
    let s = TestSetup::new();
    let event_id = s.str("ev_rel");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Fest"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &s.str("t1"));

    // Release before event date must fail
    assert_err(
        s.contract.try_release_funds(&event_id, &s.organizer),
        ContractError::EventNotEligibleForRelease,
    );

    // Advance ledger past event date
    s.env.ledger().set_timestamp(event_date + 1);

    s.contract.release_funds(&event_id, &s.organizer);
    assert_eq!(s.xlm.balance(&s.organizer), TestSetup::PRICE);
    assert_eq!(s.xlm.balance(&s.contract.address), 0);
}

#[test]
fn test_refund_when_cancelled_sets_refunded_status() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cancel");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 50);
    s.purchase(&event_id, &ticket_id);
    assert_eq!(s.xlm.balance(&s.buyer), TestSetup::PRICE * 9); // 10 minted, 1 spent

    s.contract.cancel_event(&event_id, &s.organizer);
    s.contract.refund(&ticket_id, &s.buyer);

    // Full price returned
    assert_eq!(s.xlm.balance(&s.buyer), TestSetup::PRICE * 10);
    // On-chain status is Refunded, not Used — analytics can distinguish them
    assert_eq!(
        s.contract.get_ticket(&ticket_id).status,
        TicketStatus::Refunded
    );
}

#[test]
fn test_mark_used_sets_used_status() {
    let s = TestSetup::new();
    let event_id = s.str("ev_scan");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    s.contract.mark_used(&ticket_id, &s.organizer);

    assert_eq!(s.contract.get_ticket(&ticket_id).status, TicketStatus::Used);
}

#[test]
fn test_restricted_transfer_by_marketplace() {
    let s = TestSetup::new();
    let event_id = s.str("ev_xfer");
    let ticket_id = s.str("t1");
    let new_owner = Address::generate(&s.env);

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    s.contract.restricted_transfer(&ticket_id, &new_owner);

    let ticket = s.contract.get_ticket(&ticket_id);
    assert_eq!(ticket.owner, new_owner);
    assert_eq!(ticket.status, TicketStatus::Active);
}

// ===========================================================================
// Auth verification — confirm require_auth is called on the right address
// ===========================================================================

#[test]
fn test_auth_requested_from_buyer_on_purchase() {
    let s = TestSetup::new();
    let event_id = s.str("ev_auth");
    let ticket_id = s.str("t_auth");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    // The last recorded auth should include the buyer's address for `purchase`
    let auths = s.env.auths();
    assert!(
        auths.iter().any(|(addr, _invoc)| *addr == s.buyer),
        "purchase must require_auth from buyer; recorded auths: {auths:?}"
    );
}

#[test]
fn test_auth_requested_from_organizer_on_cancel() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cancel_auth");

    s.create_event(&event_id, 10);
    s.contract.cancel_event(&event_id, &s.organizer);

    let auths = s.env.auths();
    assert!(
        auths.iter().any(|(addr, _)| *addr == s.organizer),
        "cancel_event must require_auth from organizer; recorded auths: {auths:?}"
    );
}

#[test]
fn test_restricted_transfer_rejects_when_marketplace_has_no_auth() {
    let s = TestSetup::new();
    let event_id = s.str("ev_noauth");
    let ticket_id = s.str("t_noauth");
    let new_owner = Address::generate(&s.env);

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    // Remove all auth grants — marketplace has no auth
    s.env.mock_auths(&[]);

    let result = s.contract.try_restricted_transfer(&ticket_id, &new_owner);
    assert!(
        result.is_err(),
        "restricted_transfer must fail without marketplace auth"
    );

    // Ticket state must be completely unchanged after the failed call
    s.env.mock_all_auths();
    let ticket = s.contract.get_ticket(&ticket_id);
    assert_eq!(
        ticket.owner, s.buyer,
        "owner must not change on failed transfer"
    );
    assert_eq!(
        ticket.status,
        TicketStatus::Active,
        "status must not change on failed transfer"
    );
}

// ===========================================================================
// Negative / adversarial tests
// ===========================================================================

#[test]
fn test_double_initialization_rejected() {
    let s = TestSetup::new();
    let other_marketplace = Address::generate(&s.env);
    // Second initialize call must be rejected regardless of arguments
    assert_err(
        s.contract
            .try_initialize(&s.admin, &other_marketplace, &s.xlm.address),
        ContractError::AlreadyInitialized,
    );
}

#[test]
fn test_duplicate_ticket_id_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_dup");
    let ticket_id = s.str("dup");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    // Second purchase with same ticket_id must fail — prevents ownership overwrite
    assert_err(
        s.contract.try_purchase(&event_id, &s.buyer, &ticket_id),
        ContractError::TicketAlreadyExists,
    );

    // Original ticket ownership must be intact
    assert_eq!(s.contract.get_ticket(&ticket_id).owner, s.buyer);
}

#[test]
fn test_invalid_event_params_rejected() {
    let s = TestSetup::new();
    let future = s.env.ledger().timestamp() + 86400;
    let price = TestSetup::PRICE;

    // Zero capacity
    assert_err(
        s.contract.try_create_event(
            &s.organizer,
            &s.str("ev_a"),
            &s.str("Bad"),
            &future,
            &0,
            &price,
        ),
        ContractError::InvalidCapacity,
    );
    // Negative capacity
    assert_err(
        s.contract.try_create_event(
            &s.organizer,
            &s.str("ev_b"),
            &s.str("Bad"),
            &future,
            &-1,
            &price,
        ),
        ContractError::InvalidCapacity,
    );
    // Zero price
    assert_err(
        s.contract.try_create_event(
            &s.organizer,
            &s.str("ev_c"),
            &s.str("Bad"),
            &future,
            &100,
            &0,
        ),
        ContractError::InvalidPrice,
    );
    // Negative price
    assert_err(
        s.contract.try_create_event(
            &s.organizer,
            &s.str("ev_d"),
            &s.str("Bad"),
            &future,
            &100,
            &-1,
        ),
        ContractError::InvalidPrice,
    );
    // Date in the past (timestamp 0 == ledger start in tests)
    assert_err(
        s.contract.try_create_event(
            &s.organizer,
            &s.str("ev_e"),
            &s.str("Bad"),
            &0u64,
            &100,
            &price,
        ),
        ContractError::EventDateInPast,
    );
}

#[test]
fn test_refund_requires_event_cancelled() {
    let s = TestSetup::new();
    let event_id = s.str("ev_active_refund");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    // Refund while event is still Active must fail
    assert_err(
        s.contract.try_refund(&ticket_id, &s.buyer),
        ContractError::EventNotCancelled,
    );

    // Ticket must still be Active — no state leaked
    assert_eq!(
        s.contract.get_ticket(&ticket_id).status,
        TicketStatus::Active
    );
    // Buyer's XLM must still be in escrow
    assert_eq!(s.xlm.balance(&s.contract.address), TestSetup::PRICE);
}

#[test]
fn test_refund_rejects_non_owner() {
    let s = TestSetup::new();
    let event_id = s.str("ev_unauth_refund");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);
    s.contract.cancel_event(&event_id, &s.organizer);

    // buyer2 does not own this ticket — must be rejected
    assert_err(
        s.contract.try_refund(&ticket_id, &s.buyer2),
        ContractError::TicketNotOwnedByCaller,
    );

    // Ticket still belongs to original buyer
    assert_eq!(s.contract.get_ticket(&ticket_id).owner, s.buyer);
    // No money moved
    assert_eq!(s.xlm.balance(&s.contract.address), TestSetup::PRICE);
}

#[test]
fn test_double_refund_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_dbl_refund");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);
    s.contract.cancel_event(&event_id, &s.organizer);
    s.contract.refund(&ticket_id, &s.buyer);

    // Second refund must be rejected — ticket is already Refunded
    assert_err(
        s.contract.try_refund(&ticket_id, &s.buyer),
        ContractError::TicketAlreadyUsed,
    );
    // Contract holds nothing (correctly empty)
    assert_eq!(s.xlm.balance(&s.contract.address), 0);
}

#[test]
fn test_double_release_funds_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_dbl_release");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Fest"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &s.str("t1"));

    s.env.ledger().set_timestamp(event_date + 1);
    s.contract.release_funds(&event_id, &s.organizer);

    // Second release must be rejected — event is now Completed
    assert_err(
        s.contract.try_release_funds(&event_id, &s.organizer),
        ContractError::EventAlreadyCompleted,
    );
}

#[test]
fn test_refund_after_release_rejected() {
    // If an organizer releases funds and THEN an event gets "cancelled" somehow,
    // attendees must not be able to refund from a zero escrow.
    // Simpler test: funds released → escrow is 0 → refund path is unreachable because
    // event is Completed (not Cancelled), so EventNotCancelled is returned.
    let s = TestSetup::new();
    let event_id = s.str("ev_refund_after_rel");
    let ticket_id = s.str("t1");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Gone"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &ticket_id);

    s.env.ledger().set_timestamp(event_date + 1);
    s.contract.release_funds(&event_id, &s.organizer);

    // Event is Completed, not Cancelled — refund must be rejected
    assert_err(
        s.contract.try_refund(&ticket_id, &s.buyer),
        ContractError::EventNotCancelled,
    );
    // Buyer did not receive any extra XLM
    assert_eq!(s.xlm.balance(&s.buyer), TestSetup::PRICE * 9); // spent 1 on purchase
}

#[test]
fn test_purchase_on_cancelled_event_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cancelled_buy");

    s.create_event(&event_id, 10);
    s.contract.cancel_event(&event_id, &s.organizer);

    assert_err(
        s.contract.try_purchase(&event_id, &s.buyer, &s.str("t1")),
        ContractError::EventNotActive,
    );
    // No XLM left the buyer's account
    assert_eq!(s.xlm.balance(&s.buyer), TestSetup::PRICE * 10);
}

#[test]
fn test_purchase_on_completed_event_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_completed_buy");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Done"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &s.str("t1"));
    s.env.ledger().set_timestamp(event_date + 1);
    s.contract.release_funds(&event_id, &s.organizer);

    // Purchasing on a Completed event must be rejected
    assert_err(
        s.contract.try_purchase(&event_id, &s.buyer2, &s.str("t2")),
        ContractError::EventNotActive,
    );
}

#[test]
fn test_mark_used_by_non_organizer_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_scan_auth");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);

    // buyer2 is not the organizer
    assert_err(
        s.contract.try_mark_used(&ticket_id, &s.buyer2),
        ContractError::OnlyOrganizerAllowed,
    );
    // Ticket must still be Active
    assert_eq!(
        s.contract.get_ticket(&ticket_id).status,
        TicketStatus::Active
    );
}

#[test]
fn test_mark_used_twice_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_scan_dbl");
    let ticket_id = s.str("t1");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);
    s.contract.mark_used(&ticket_id, &s.organizer);

    // Scanning an already-scanned ticket must fail — prevents replay at the door
    assert_err(
        s.contract.try_mark_used(&ticket_id, &s.organizer),
        ContractError::TicketAlreadyUsed,
    );
}

#[test]
fn test_restricted_transfer_rejects_used_ticket() {
    let s = TestSetup::new();
    let event_id = s.str("ev_xfer_used");
    let ticket_id = s.str("t1");
    let new_owner = Address::generate(&s.env);

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &ticket_id);
    s.contract.mark_used(&ticket_id, &s.organizer);

    // Marketplace cannot transfer a ticket that has already been scanned
    assert_err(
        s.contract.try_restricted_transfer(&ticket_id, &new_owner),
        ContractError::TicketAlreadyUsed,
    );
}

#[test]
fn test_cancel_already_completed_event_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cancel_complete");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Over"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &s.str("t1"));
    s.env.ledger().set_timestamp(event_date + 1);
    s.contract.release_funds(&event_id, &s.organizer);

    // Cancelling a Completed event must fail
    assert_err(
        s.contract.try_cancel_event(&event_id, &s.organizer),
        ContractError::EventAlreadyCompleted,
    );
}

#[test]
fn test_non_organizer_cannot_release_funds() {
    let s = TestSetup::new();
    let event_id = s.str("ev_rel_auth");
    let event_date = s.env.ledger().timestamp() + 100;

    s.contract.create_event(
        &s.organizer,
        &event_id,
        &s.str("Fest"),
        &event_date,
        &50,
        &TestSetup::PRICE,
    );
    s.purchase(&event_id, &s.str("t1"));
    s.env.ledger().set_timestamp(event_date + 1);

    // buyer2 is not the organizer of this event
    assert_err(
        s.contract.try_release_funds(&event_id, &s.buyer2),
        ContractError::OnlyOrganizerAllowed,
    );
    // Organizer has received nothing
    assert_eq!(s.xlm.balance(&s.organizer), 0);
}

#[test]
fn test_release_funds_on_cancelled_event_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_rel_cancelled");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &s.str("t1"));
    s.contract.cancel_event(&event_id, &s.organizer);

    assert_err(
        s.contract.try_release_funds(&event_id, &s.organizer),
        ContractError::EventNotActive,
    );
}

#[test]
fn test_escrow_accounting_across_multiple_purchases() {
    let s = TestSetup::new();
    let event_id = s.str("ev_escrow");

    s.create_event(&event_id, 10);
    s.purchase(&event_id, &s.str("t1"));
    s.contract.purchase(&event_id, &s.buyer2, &s.str("t2"));

    // Both tickets paid; escrow must hold 2× price
    assert_eq!(s.xlm.balance(&s.contract.address), TestSetup::PRICE * 2);

    // Cancel and refund both; escrow must drain to 0
    s.contract.cancel_event(&event_id, &s.organizer);
    s.contract.refund(&s.str("t1"), &s.buyer);
    s.contract.refund(&s.str("t2"), &s.buyer2);

    assert_eq!(s.xlm.balance(&s.contract.address), 0);
    assert_eq!(s.xlm.balance(&s.buyer), TestSetup::PRICE * 10);
    assert_eq!(s.xlm.balance(&s.buyer2), TestSetup::PRICE * 10);
}
