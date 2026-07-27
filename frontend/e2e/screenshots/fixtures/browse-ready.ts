const poster = (title: string, accent: string): string => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="1200" height="675" viewBox="0 0 1200 675">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#15181C"/>
          <stop offset="1" stop-color="${accent}"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="675" fill="url(#g)"/>
      <circle cx="980" cy="120" r="180" fill="#ffffff" fill-opacity="0.08"/>
      <circle cx="160" cy="590" r="260" fill="#ffffff" fill-opacity="0.05"/>
      <text x="72" y="540" fill="#ffffff" font-family="Arial, sans-serif" font-size="64" font-weight="700">${title}</text>
    </svg>`;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
};

const ticketContractId = `C${'A'.repeat(55)}`;
const organizerAddress = `G${'B'.repeat(55)}`;
const creationTxHash = '7'.repeat(64);

export interface DiscoverableEventFixture {
  event_id: string;
  organizer_address: string;
  organizer_display_name: string;
  name: string;
  summary: string;
  description: string;
  image_url: string;
  category: string;
  date_unix: number;
  end_unix: number;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  support_contact: string;
  refund_policy_code: 'cancelled_event_original_price';
  resale_policy_code: 'stellar_marketplace_unlocked';
  entry_instructions: string;
  capacity: number;
  price_per_ticket: number;
  current_supply: number;
  status: 'Active';
  network: 'StellarTestnet';
  ticket_contract_id: string;
  creation_tx_hash: string;
  chain_verified_at: string;
}

const event = (
  input: Pick<
    DiscoverableEventFixture,
    | 'event_id'
    | 'name'
    | 'summary'
    | 'category'
    | 'date_unix'
    | 'end_unix'
    | 'venue'
    | 'address'
    | 'city'
    | 'capacity'
    | 'price_per_ticket'
    | 'current_supply'
  > & { accent: string },
): DiscoverableEventFixture => {
  const { accent, ...fields } = input;

  return {
    ...fields,
    organizer_address: organizerAddress,
    organizer_display_name: 'Stellar City Collective',
    description: `${fields.summary} This seeded event is used only for deterministic visual capture.`,
    image_url: poster(fields.name, accent),
    timezone: 'Asia/Kolkata',
    support_contact: 'support@example.test',
    refund_policy_code: 'cancelled_event_original_price',
    resale_policy_code: 'stellar_marketplace_unlocked',
    entry_instructions: 'Present the rotating ticket QR at the entrance.',
    status: 'Active',
    network: 'StellarTestnet',
    ticket_contract_id: ticketContractId,
    creation_tx_hash: creationTxHash,
    chain_verified_at: '2026-07-27T06:30:00.000Z',
  };
};

export const BROWSE_READY_EVENTS: readonly DiscoverableEventFixture[] = [
  event({
    event_id: 'event-seed-a-01',
    name: 'Midnight Frequency',
    summary: 'An electronic music showcase with live visual performances.',
    category: 'Music',
    date_unix: Date.parse('2026-09-12T19:30:00+05:30') / 1000,
    end_unix: Date.parse('2026-09-12T23:00:00+05:30') / 1000,
    venue: 'The Foundry',
    address: '12 Residency Road',
    city: 'Bengaluru',
    capacity: 500,
    price_per_ticket: 180_000_000,
    current_supply: 214,
    accent: '#5B3FD8',
  }),
  event({
    event_id: 'event-seed-a-02',
    name: 'Builders on Stellar',
    summary: 'A practical conference for teams shipping real products on Stellar.',
    category: 'Tech',
    date_unix: Date.parse('2026-09-20T10:00:00+05:30') / 1000,
    end_unix: Date.parse('2026-09-20T17:30:00+05:30') / 1000,
    venue: 'Bangalore International Centre',
    address: '7 Domlur II Stage',
    city: 'Bengaluru',
    capacity: 320,
    price_per_ticket: 90_000_000,
    current_supply: 58,
    accent: '#176B87',
  }),
  event({
    event_id: 'event-seed-a-03',
    name: 'Indie After Dark',
    summary: 'Three independent bands, one intimate stage, and no filler.',
    category: 'Music',
    date_unix: Date.parse('2026-10-03T18:00:00+05:30') / 1000,
    end_unix: Date.parse('2026-10-03T22:30:00+05:30') / 1000,
    venue: 'AntiSocial',
    address: 'Mathuradas Mill Compound',
    city: 'Mumbai',
    capacity: 240,
    price_per_ticket: 125_000_000,
    current_supply: 119,
    accent: '#8A3FFC',
  }),
  event({
    event_id: 'event-seed-a-04',
    name: 'Night Run 10K',
    summary: 'A timed city run designed for first-time and experienced runners.',
    category: 'Sports',
    date_unix: Date.parse('2026-10-10T20:00:00+05:30') / 1000,
    end_unix: Date.parse('2026-10-10T23:00:00+05:30') / 1000,
    venue: 'Jawaharlal Nehru Stadium',
    address: 'Lodhi Road',
    city: 'New Delhi',
    capacity: 1200,
    price_per_ticket: 60_000_000,
    current_supply: 846,
    accent: '#0C7C59',
  }),
  event({
    event_id: 'event-seed-a-05',
    name: 'The Last Rehearsal',
    summary: 'A contemporary stage production about ambition, doubt, and friendship.',
    category: 'Theater',
    date_unix: Date.parse('2026-10-18T18:30:00+05:30') / 1000,
    end_unix: Date.parse('2026-10-18T21:00:00+05:30') / 1000,
    venue: 'Prithvi Theatre',
    address: '20 Janki Kutir',
    city: 'Mumbai',
    capacity: 180,
    price_per_ticket: 75_000_000,
    current_supply: 151,
    accent: '#A33D3D',
  }),
  event({
    event_id: 'event-seed-a-06',
    name: 'Weekend Laughs',
    summary: 'A compact comedy lineup featuring four emerging performers.',
    category: 'Comedy',
    date_unix: Date.parse('2026-10-24T19:00:00+05:30') / 1000,
    end_unix: Date.parse('2026-10-24T21:30:00+05:30') / 1000,
    venue: 'The Habitat',
    address: 'Road Number 3, Khar West',
    city: 'Mumbai',
    capacity: 150,
    price_per_ticket: 45_000_000,
    current_supply: 36,
    accent: '#B36B00',
  }),
];