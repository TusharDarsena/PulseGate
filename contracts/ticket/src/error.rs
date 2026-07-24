use soroban_sdk::contracterror;

#[derive(Debug, Copy, Clone, PartialEq)]
#[contracterror]
pub enum ContractError {
    // Initialization
    AlreadyInitialized = 1,
    NotInitialized = 2,

    // Event errors
    EventNotFound = 3,
    EventNotActive = 4,
    EventCapacityExceeded = 5,
    EventNotCancelled = 6,
    EventNotEligibleForRelease = 7,
    EventAlreadyCompleted = 8,
    EventAlreadyExists = 18,
    InvalidCapacity = 19,
    InvalidPrice = 20,
    EventDateInPast = 21,
    EventSalesClosed = 23,

    // Ticket errors
    TicketNotFound = 9,
    TicketAlreadyUsed = 10,
    TicketNotOwnedByCaller = 11,
    TicketAlreadyExists = 22,

    // Auth errors
    OnlyOrganizerAllowed = 12,
    OnlyMarketplaceAllowed = 13,

    // Escrow errors
    InsufficientEscrowBalance = 14,

    // Arithmetic
    Overflow = 15,
    Underflow = 16,
    DivisionByZero = 17,
}
