import { Event, Ticket } from '../types';

export const MOCK_EVENTS: Event[] = [
  // Attendee Browse Events
  {
    eventId: 'evt_1',
    organizer: 'org_1',
    name: 'Neon Velocity World Tour',
    dateUnix: 1729800000, // Oct 24, 2024
    capacity: 500,
    pricePerTicket: 450000000, // 45 XLM
    currentSupply: 488,
    status: 'Active',
    venue: 'Crystal Arena',
    city: 'Tokyo',
    imageUrl: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?w=800&q=80'
  },
  {
    eventId: 'evt_2',
    organizer: 'org_2',
    name: 'Global Champions League',
    dateUnix: 1731425400, // Nov 12, 2024
    capacity: 10000,
    pricePerTicket: 1200000000, // 120 XLM
    currentSupply: 10000, // Waitlist (Sold out)
    status: 'Active',
    venue: 'Metropolis Stadium',
    city: 'London',
    imageUrl: 'https://images.unsplash.com/photo-1540747913346-19e32dc3e97e?w=800&q=80'
  },
  {
    eventId: 'evt_3',
    organizer: 'org_3',
    name: 'Elysium: The Opera',
    dateUnix: 1733425200, // Dec 05, 2024
    capacity: 1200,
    pricePerTicket: 855000000, // 85.50 XLM
    currentSupply: 1158,
    status: 'Active',
    venue: 'Royal Hall',
    city: 'Paris',
    imageUrl: 'https://images.unsplash.com/photo-1507676184212-d0330a156f95?w=800&q=80'
  },
  {
    eventId: 'evt_4',
    organizer: 'org_4',
    name: 'Stellar Arts Festival',
    dateUnix: 1755248400, // Aug 15, 2025
    capacity: 5000,
    pricePerTicket: 250000000, // 25 XLM
    currentSupply: 4000,
    status: 'Active',
    venue: 'Bay Area Park',
    city: 'San Francisco',
    imageUrl: 'https://images.unsplash.com/photo-1533174000255-b0728c03c5b5?w=800&q=80'
  },
  {
    eventId: 'evt_5',
    organizer: 'org_2',
    name: 'BLOCKCHAIN SUMMIT',
    dateUnix: 1736067600,
    capacity: 5000,
    pricePerTicket: 0,
    currentSupply: 5000,
    status: 'Active',
    venue: 'Web3 Convention Center',
    city: 'Miami',
    imageUrl: 'https://images.unsplash.com/photo-1516245834210-c4c142787335?w=800&q=80'
  },

  // Organizer Dashboard Events
  {
    eventId: 'evt_org_1',
    organizer: 'G...ORG',
    name: 'Nebula Nights: Summer Gala',
    dateUnix: 1692057600,
    capacity: 500,
    pricePerTicket: 1500000000,
    currentSupply: 500,
    status: 'Completed',
    imageUrl: 'https://images.unsplash.com/photo-1540039155732-d67414006c3a?w=400&q=80',
    venue: 'The Void Arena',
    city: 'New York',
  },
  {
    eventId: 'evt_org_2',
    organizer: 'G...ORG',
    name: 'Stellar DevCon 2024',
    dateUnix: 1729641600,
    capacity: 1500,
    pricePerTicket: 500000000,
    currentSupply: 748,
    status: 'Active',
    imageUrl: 'https://images.unsplash.com/photo-1505373877841-8d25f7d46678?w=400&q=80',
    venue: 'Silicon Plaza',
    city: 'San Francisco',
  },
  {
    eventId: 'evt_org_3',
    organizer: 'G...ORG',
    name: 'NFT Art Expo',
    dateUnix: 1720137600,
    capacity: 300,
    pricePerTicket: 800000000,
    currentSupply: 120,
    status: 'Active',
    imageUrl: 'https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=400&q=80',
    venue: 'Metropolis Gallery',
    city: 'Los Angeles',
  },
];

export const MOCK_TICKETS: Ticket[] = [
  {
    ticketId: 'xlr_8293_stellar_9021_f92_vlt',
    eventId: 'evt_1',
    owner: 'G...3k9P',
    status: 'Active' as const,
  },
  {
    ticketId: 'st_9942_vault_1102_a33_chain',
    eventId: 'evt_5',
    owner: 'G...3k9P',
    status: 'Active' as const,
  }
];
