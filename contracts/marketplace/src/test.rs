#![cfg(test)]

use crate::ticket_interface::TicketContractClient;
use soroban_sdk::{testutils::Address as _, token, Address, Env, String, Symbol};
use ticket::TicketContract;
use token::Client as TokenClient;
use token::StellarAssetClient as TokenAdminClient;

use crate::error::ContractError;
use crate::types::ListingStatus;
use crate::{MarketplaceContract, MarketplaceContractClient};

// ---------------------------------------------------------------------------
// Test fixture — single setup struct eliminates all per-test boilerplate
// ---------------------------------------------------------------------------

struct TestSetup<'a> {
    env: Env,
    admin: Address,
    organizer: Address,
    seller: Address,
    buyer: Address,
    buyer2: Address,
    xlm: TokenClient<'a>,
    ticket: TicketContractClient<'a>,
    marketplace: MarketplaceContractClient<'a>,
}

impl<'a> TestSetup<'a> {
    const PRICE: i128 = 10_000_000; // 1 XLM in stroops
    const ROYALTY_RATE: i128 = 10; // 10%

    fn new() -> Self {
        Self::new_with_rate(Self::ROYALTY_RATE)
    }

    fn new_with_rate(rate: i128) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let organizer = Address::generate(&env);
        let seller = Address::generate(&env);
        let buyer = Address::generate(&env);
        let buyer2 = Address::generate(&env);

        // Register XLM SAC and pre-fund all participants
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let xlm = TokenClient::new(&env, &sac.address());
        let xlm_admin = TokenAdminClient::new(&env, &sac.address());

        xlm_admin.mint(&seller, &(Self::PRICE * 10));
        xlm_admin.mint(&buyer, &(Self::PRICE * 20));
        xlm_admin.mint(&buyer2, &(Self::PRICE * 20));

        // Deploy MarketplaceContract first so we have its address for TicketContract.initialize
        let marketplace_addr = env.register(MarketplaceContract, ());
        let marketplace = MarketplaceContractClient::new(&env, &marketplace_addr);

        // Deploy TicketContract, initialize with marketplace address + XLM token
        let ticket_addr = env.register(TicketContract, ());
        let ticket = TicketContractClient::new(&env, &ticket_addr);
        ticket.initialize(&admin, &marketplace_addr, &xlm.address);

        // Initialize MarketplaceContract with ticket address + royalty rate
        marketplace.initialize(&admin, &ticket_addr, &rate);

        Self {
            env,
            admin,
            organizer,
            seller,
            buyer,
            buyer2,
            xlm,
            ticket,
            marketplace,
        }
    }

    /// Create a standard event (capacity 100, price 1 XLM, date +1 day).
    fn create_event(&self, event_id: &String) {
        self.ticket.create_event(
            &self.organizer,
            event_id,
            &String::from_str(&self.env, "TestEvent"),
            &(self.env.ledger().timestamp() + 86_400),
            &(self.env.ledger().timestamp() + 90_000),
            &100,
            &Self::PRICE,
        );
    }

    /// Purchase a ticket as the given buyer.
    fn purchase(&self, event_id: &String, ticket_id: &String, buyer: &Address) {
        self.ticket.purchase(event_id, buyer, ticket_id);
    }

    fn open_check_in(&self, event_id: &String) {
        let event = self.ticket.get_event(event_id);
        self.env.ledger().set_timestamp(event.date_unix - 1);
    }

    /// List a ticket as the seller.
    fn list(&self, listing_id: &String, ticket_id: &String, event_id: &String, price: i128) {
        self.marketplace
            .list_ticket(&self.seller, listing_id, ticket_id, event_id, &price);
    }

    fn str(&self, s: &str) -> String {
        String::from_str(&self.env, s)
    }

    fn sym(&self, s: &str) -> Symbol {
        Symbol::new(&self.env, s)
    }
}

// ---------------------------------------------------------------------------
// Helper: assert a try_* call fails with a specific ContractError variant.
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
fn test_list_and_buy_full_flow() {
    let s = TestSetup::new();
    let event_id = s.str("ev1");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);

    let seller_balance_before = s.xlm.balance(&s.seller);
    let organizer_balance_before = s.xlm.balance(&s.organizer);
    let buyer_balance_before = s.xlm.balance(&s.buyer);

    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    // Ticket ownership transferred to buyer
    let ticket = s.ticket.get_ticket(&ticket_id);
    assert_eq!(ticket.owner, s.buyer);

    // Listing marked Sold
    let listing = s.marketplace.get_listing(&s.seller, &listing_id);
    assert_eq!(listing.status, ListingStatus::Sold);

    // Royalty = ceiling(10_000_000 * 10 / 100) = 1_000_000
    let expected_royalty = 1_000_000i128;
    let expected_proceeds = TestSetup::PRICE - expected_royalty;

    assert_eq!(
        s.xlm.balance(&s.organizer),
        organizer_balance_before + expected_royalty
    );
    assert_eq!(
        s.xlm.balance(&s.seller),
        seller_balance_before + expected_proceeds
    );
    assert_eq!(
        s.xlm.balance(&s.buyer),
        buyer_balance_before - TestSetup::PRICE
    );
    // Contract holds nothing — all XLM distributed
    assert_eq!(s.xlm.balance(&s.marketplace.address), 0);
}

#[test]
fn test_cancel_listing() {
    let s = TestSetup::new();
    let event_id = s.str("ev_cancel");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);

    s.marketplace.cancel_listing(&s.seller, &listing_id);

    let listing = s.marketplace.get_listing(&s.seller, &listing_id);
    assert_eq!(listing.status, ListingStatus::Cancelled);
    // Ticket still owned by seller — no state changed
    assert_eq!(s.ticket.get_ticket(&ticket_id).owner, s.seller);
}

#[test]
fn test_ceiling_royalty_micro_transaction() {
    let s = TestSetup::new();
    let event_id = s.str("ev_micro");
    // Create event with price 9 stroops (below the 10% royalty threshold for floor division)
    s.ticket.create_event(
        &s.organizer,
        &event_id,
        &String::from_str(&s.env, "Micro"),
        &(s.env.ledger().timestamp() + 86_400),
        &(s.env.ledger().timestamp() + 90_000),
        &100,
        &9, // 9 stroops
    );
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.ticket.purchase(&event_id, &s.seller, &ticket_id);

    s.marketplace
        .list_ticket(&s.seller, &listing_id, &ticket_id, &event_id, &9);
    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    // Ceiling: (9 * 10 + 99) / 100 = 189 / 100 = 1 (not 0)
    // Organizer must receive at least 1 stroop — no royalty evasion via micro-pricing
    let organizer_balance = s.xlm.balance(&s.organizer);
    assert_eq!(
        organizer_balance, 1,
        "ceiling division must give organizer at least 1 stroop"
    );
}

#[test]
fn test_zero_royalty_rate_no_transfer_panic() {
    // Use a fresh deployment where the ticket contract knows about this marketplace.
    // Registering a second marketplace on top of the default setup would fail because
    // restricted_transfer checks for auth from the stored marketplace address.
    let s = TestSetup::new_with_rate(0);

    let event_id = s.str("ev_zero");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    // royalty = ceiling(PRICE * 0 + 99) / 100 = 99 / 100 = 0
    // Guard in buy_listing skips the organizer transfer (token SAC panics on amount=0).
    // Seller receives full ask_price, organizer receives nothing.
    // Seller balance: started at PRICE*10, spent PRICE to buy ticket, got PRICE back as proceeds → net PRICE*10.
    assert_eq!(s.xlm.balance(&s.organizer), 0);
    assert_eq!(s.xlm.balance(&s.seller), TestSetup::PRICE * 10);
    assert_eq!(s.ticket.get_ticket(&ticket_id).owner, s.buyer);
}

#[test]
fn test_royalty_amounts_exact() {
    let s = TestSetup::new();
    let event_id = s.str("ev_exact");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);

    let organizer_before = s.xlm.balance(&s.organizer);
    let seller_before = s.xlm.balance(&s.seller);

    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    // 10_000_000 stroops * 10% = 1_000_000 royalty, 9_000_000 to seller
    assert_eq!(s.xlm.balance(&s.organizer) - organizer_before, 1_000_000);
    assert_eq!(s.xlm.balance(&s.seller) - seller_before, 9_000_000);
}

#[test]
fn test_stale_listing_fails_fast_ticket_used() {
    let s = TestSetup::new();
    let event_id = s.str("ev_stale");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);

    // Organizer scans the ticket at the door — seller still "owns" the ticket
    // but it is Used. restricted_transfer will fail.
    // However, since owner == seller still, TicketOwnerMismatch won't fire.
    // The fail happens at restricted_transfer level (TicketAlreadyUsed from ticket contract).
    s.open_check_in(&event_id);
    s.ticket
        .mark_used(&event_id, &ticket_id, &s.seller, &s.organizer);

    // Buy attempt should fail (entire tx rolled back — no XLM lost by buyer)
    let buyer_balance_before = s.xlm.balance(&s.buyer);
    let result = s
        .marketplace
        .try_buy_listing(&s.seller, &listing_id, &s.buyer);
    assert!(result.is_err(), "buy_listing must fail for a used ticket");
    // Buyer's balance unchanged — rollback worked
    assert_eq!(s.xlm.balance(&s.buyer), buyer_balance_before);
}

#[test]
fn test_event_id_forgery_blocked() {
    let s = TestSetup::new();

    // Attacker (seller) creates their own event — they are the organizer
    let real_event_id = s.str("ev_real");
    let fake_event_id = s.str("ev_fake");

    // Real event created by someone else (organizer), ticket purchased by seller
    s.create_event(&real_event_id);
    let ticket_id = s.str("t1");
    s.purchase(&real_event_id, &ticket_id, &s.seller);

    // Attacker creates their own fake event where they are organizer
    s.ticket.create_event(
        &s.seller,
        &fake_event_id,
        &String::from_str(&s.env, "FakeEv"),
        &(s.env.ledger().timestamp() + 86_400),
        &(s.env.ledger().timestamp() + 90_000),
        &100,
        &TestSetup::PRICE,
    );

    let listing_id = s.str("l1");
    // Attacker lists with the FAKE event_id hoping royalties go to them as organizer
    s.marketplace.list_ticket(
        &s.seller,
        &listing_id,
        &ticket_id,
        &fake_event_id,
        &TestSetup::PRICE,
    );

    let seller_before = s.xlm.balance(&s.seller);
    let organizer_before = s.xlm.balance(&s.organizer);

    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    // buy_listing reads the TRUE event_id from the ticket on-chain record (real_event_id),
    // so the royalty goes to the real organizer — NOT to the seller/attacker.
    let royalty = 1_000_000i128;
    assert_eq!(
        s.xlm.balance(&s.organizer),
        organizer_before + royalty,
        "royalty must go to real organizer despite forged event_id in listing"
    );
    // Seller receives only the proceeds, not the royalty
    assert_eq!(
        s.xlm.balance(&s.seller),
        seller_before + TestSetup::PRICE - royalty
    );
}

#[test]
fn test_auth_correctly_required() {
    let s = TestSetup::new();
    let event_id = s.str("ev_auth");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    let auths = s.env.auths();
    assert!(
        auths.iter().any(|(addr, _)| *addr == s.buyer),
        "buy_listing must require_auth from buyer; recorded auths: {auths:?}"
    );
}

// ===========================================================================
// Adversarial / negative tests
// ===========================================================================

#[test]
fn test_double_initialize_rejected() {
    let s = TestSetup::new();
    assert_err(
        s.marketplace
            .try_initialize(&s.admin, &s.ticket.address, &10),
        ContractError::AlreadyInitialized,
    );
}

#[test]
fn test_duplicate_listing_id_same_seller_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_dup");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &s.str("t1"), &s.seller);
    s.purchase(&event_id, &s.str("t2"), &s.seller);

    s.list(&listing_id, &s.str("t1"), &event_id, TestSetup::PRICE);
    // Same seller, same listing_id must be rejected
    assert_err(
        s.marketplace.try_list_ticket(
            &s.seller,
            &listing_id,
            &s.str("t2"),
            &event_id,
            &TestSetup::PRICE,
        ),
        ContractError::ListingAlreadyExists,
    );
}

#[test]
fn test_different_sellers_can_reuse_listing_id() {
    let s = TestSetup::new();
    let event_id = s.str("ev_ns");
    // Both sellers use the same listing_id "l1" — namespacing must prevent collision
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &s.str("t1"), &s.seller);
    s.purchase(&event_id, &s.str("t2"), &s.buyer2);

    // seller lists as themselves
    s.marketplace.list_ticket(
        &s.seller,
        &listing_id,
        &s.str("t1"),
        &event_id,
        &TestSetup::PRICE,
    );
    // buyer2 lists with the same listing_id — must succeed (different namespace)
    s.marketplace.list_ticket(
        &s.buyer2,
        &listing_id,
        &s.str("t2"),
        &event_id,
        &TestSetup::PRICE,
    );

    // Both listings are independently accessible
    assert_eq!(
        s.marketplace.get_listing(&s.seller, &listing_id).status,
        ListingStatus::Open
    );
    assert_eq!(
        s.marketplace.get_listing(&s.buyer2, &listing_id).status,
        ListingStatus::Open
    );
}

#[test]
fn test_buy_sold_listing_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_sold");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.buy_listing(&s.seller, &listing_id, &s.buyer);

    assert_err(
        s.marketplace
            .try_buy_listing(&s.seller, &listing_id, &s.buyer2),
        ContractError::ListingNotOpen,
    );
}

#[test]
fn test_buy_cancelled_listing_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_canc_buy");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.cancel_listing(&s.seller, &listing_id);

    assert_err(
        s.marketplace
            .try_buy_listing(&s.seller, &listing_id, &s.buyer),
        ContractError::ListingNotOpen,
    );
}

#[test]
fn test_buy_listing_rejects_cancelled_event() {
    let s = TestSetup::new();
    let event_id = s.str("ev_event_cancelled");
    let ticket_id = s.str("t_event_cancelled");
    let listing_id = s.str("l_event_cancelled");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.ticket.cancel_event(&event_id, &s.organizer);

    let buyer_balance_before = s.xlm.balance(&s.buyer);
    assert_err(
        s.marketplace
            .try_buy_listing(&s.seller, &listing_id, &s.buyer),
        ContractError::EventNotActive,
    );
    assert_eq!(s.xlm.balance(&s.buyer), buyer_balance_before);
    assert_eq!(
        s.marketplace.get_listing(&s.seller, &listing_id).status,
        ListingStatus::Open
    );
    assert_eq!(s.ticket.get_ticket(&ticket_id).owner, s.seller);
}

#[test]
fn test_buy_listing_rejects_completed_event() {
    let s = TestSetup::new();
    let event_id = s.str("ev_event_completed");
    let ticket_id = s.str("t_event_completed");
    let listing_id = s.str("l_event_completed");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    let event = s.ticket.get_event(&event_id);
    s.env.ledger().set_timestamp(event.end_unix);
    s.ticket.release_funds(&event_id, &s.organizer);

    let buyer_balance_before = s.xlm.balance(&s.buyer);
    assert_err(
        s.marketplace
            .try_buy_listing(&s.seller, &listing_id, &s.buyer),
        ContractError::EventNotActive,
    );
    assert_eq!(s.xlm.balance(&s.buyer), buyer_balance_before);
    assert_eq!(
        s.marketplace.get_listing(&s.seller, &listing_id).status,
        ListingStatus::Open
    );
    assert_eq!(s.ticket.get_ticket(&ticket_id).owner, s.seller);
}

#[test]
fn test_buyer_is_seller_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_self");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);

    assert_err(
        s.marketplace
            .try_buy_listing(&s.seller, &listing_id, &s.seller),
        ContractError::BuyerIsSeller,
    );
}

#[test]
fn test_negative_price_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_negprice");
    let ticket_id = s.str("t1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);

    assert_err(
        s.marketplace
            .try_list_ticket(&s.seller, &s.str("l1"), &ticket_id, &event_id, &-1),
        ContractError::InvalidPrice,
    );
    assert_err(
        s.marketplace
            .try_list_ticket(&s.seller, &s.str("l2"), &ticket_id, &event_id, &0),
        ContractError::InvalidPrice,
    );
}

#[test]
fn test_double_cancel_rejected() {
    let s = TestSetup::new();
    let event_id = s.str("ev_dblcanc");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);
    s.marketplace.cancel_listing(&s.seller, &listing_id);

    assert_err(
        s.marketplace.try_cancel_listing(&s.seller, &listing_id),
        ContractError::ListingNotOpen,
    );
}

#[test]
fn test_cancel_by_different_seller_rejected() {
    // Buyer2 cannot cancel a listing that belongs to seller.
    // Because DataKey is namespaced by seller, buyer2's lookup returns NotFound.
    let s = TestSetup::new();
    let event_id = s.str("ev_auth_cancel");
    let ticket_id = s.str("t1");
    let listing_id = s.str("l1");

    s.create_event(&event_id);
    s.purchase(&event_id, &ticket_id, &s.seller);
    s.list(&listing_id, &ticket_id, &event_id, TestSetup::PRICE);

    // buyer2 tries to cancel seller's listing — gets ListingNotFound (different namespace)
    assert_err(
        s.marketplace.try_cancel_listing(&s.buyer2, &listing_id),
        ContractError::ListingNotFound,
    );
    // seller's listing is still Open
    assert_eq!(
        s.marketplace.get_listing(&s.seller, &listing_id).status,
        ListingStatus::Open
    );
}
