use soroban_sdk::contracterror;

#[derive(Debug, Copy, Clone, PartialEq)]
#[contracterror]
pub enum ContractError {
    // Initialization
    AlreadyInitialized = 1,
    NotInitialized = 2,

    // Listing errors
    ListingNotFound = 3,
    ListingNotOpen = 4,
    ListingAlreadyExists = 5,
    InvalidPrice = 6,
    NotListingSeller = 7,
    BuyerIsSeller = 8,

    // Arithmetic
    Overflow = 9,
    Underflow = 10,
    DivisionByZero = 11,

    // Stale listing (fail-fast before token transfers)
    TicketOwnerMismatch = 12,

    // Event status
    EventCancelled = 13,
    EventNotActive = 14,
}
