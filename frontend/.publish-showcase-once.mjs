import { Client as TicketClient } from 'ticket';
import {
  Keypair,
  TransactionBuilder,
  contract,
} from '@stellar/stellar-sdk';

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name}`);
  return value;
};

const config = {
  supabaseUrl: required('PULSEGATE_SUPABASE_URL'),
  accessToken: required('PULSEGATE_ACCESS_TOKEN'),
  organizerSecret: required('PULSEGATE_ORGANIZER_SECRET'),
  ticketContractId: required('PULSEGATE_TICKET_CONTRACT_ID'),
  rpcUrl: required('PULSEGATE_RPC_URL'),
  networkPassphrase: required('PULSEGATE_NETWORK_PASSPHRASE'),
};

const organizerKeypair = Keypair.fromSecret(config.organizerSecret);
const organizerAddress = organizerKeypair.publicKey();
const nodeSigner = contract.basicNodeSigner(
  organizerKeypair,
  config.networkPassphrase,
);
const ticket = new TicketClient({
  contractId: config.ticketContractId,
  networkPassphrase: config.networkPassphrase,
  rpcUrl: config.rpcUrl,
  publicKey: organizerAddress,
});

const unix = (value) => Math.floor(Date.parse(value) / 1000);
const imageBase = 'https://stellar-gamma-weld.vercel.app/demo-media/events';
const shared = {
  timezone: 'Asia/Kolkata',
  support_contact: 'support@pulsegate.test',
  entry_instructions:
    'Bring the rotating PulseGate ticket QR and a matching photo ID. Doors close 30 minutes after the published start time.',
  accessibility_notes:
    'Step-free entry and an accessible check-in lane are available.',
  prohibited_items:
    'Outside alcohol, weapons, professional recording equipment, and large bags.',
  map_url: null,
  public_links: [],
};

const events = [
  {
    name: 'Neon Monsoon Sessions',
    organizer_display_name: 'PulseGate Live',
    category: 'Music',
    start: '2026-08-08T18:30:00+05:30',
    end: '2026-08-08T22:30:00+05:30',
    capacity: 600,
    priceXlm: 18,
    venue: 'Ulsoor Creative Yard',
    address: 'Demo Venue, Ulsoor',
    city: 'Bengaluru',
    image: 'neon-monsoon-sessions.webp',
    summary:
      'An electric monsoon-night set where bass, light, and rain-inspired visuals move as one.',
    description:
      'Neon Monsoon Sessions brings electronic producers, live percussion, and immersive light design into one high-energy Bengaluru evening. Expect a carefully paced journey from atmospheric opening sets to a full-scale closing performance, with protected on-chain tickets and verified entry at the door.',
    age_restriction:
      '16+. Guests under 18 must be accompanied by an adult.',
  },
  {
    name: 'Indie After Dark',
    organizer_display_name: 'PulseGate Live',
    category: 'Music',
    start: '2026-08-15T19:00:00+05:30',
    end: '2026-08-15T22:00:00+05:30',
    capacity: 350,
    priceXlm: 25,
    venue: 'Harbor Room',
    address: 'Demo Venue, Lower Parel',
    city: 'Mumbai',
    image: 'indie-after-dark.webp',
    summary:
      'A close-room showcase for guitar-driven sets, new voices, and late-night listeners.',
    description:
      'Indie After Dark is an intimate three-act showcase built for listeners who prefer the texture of a small room to a festival field. The evening pairs emerging songwriting with warm stage production and a relaxed intermission space for artists and attendees.',
    age_restriction: '18+.',
  },
  {
    name: 'Stellar Builders Summit India',
    organizer_display_name: 'Build Commons India',
    category: 'Tech',
    start: '2026-08-22T09:30:00+05:30',
    end: '2026-08-22T17:30:00+05:30',
    capacity: 400,
    priceXlm: 8,
    venue: 'Orbit Convention Hall',
    address: 'Demo Venue, Whitefield',
    city: 'Bengaluru',
    image: 'stellar-builders-summit.webp',
    summary:
      'A practical day for developers building payments, identity, and real-world apps on Stellar.',
    description:
      'Stellar Builders Summit India combines concise technical talks, live product breakdowns, and guided implementation sessions. Attendees can follow a product from contract design through wallet signing, indexing, and production UX while meeting builders working across the ecosystem.',
    age_restriction: '16+.',
  },
  {
    name: 'AI & Open Web Lab',
    organizer_display_name: 'Build Commons India',
    category: 'Tech',
    start: '2026-08-29T11:00:00+05:30',
    end: '2026-08-29T16:00:00+05:30',
    capacity: 220,
    priceXlm: 12,
    venue: 'Foundry Labs',
    address: 'Demo Venue, HITEC City',
    city: 'Hyderabad',
    image: 'ai-open-web-lab.webp',
    summary:
      'A hands-on lab for prototyping useful AI workflows on open, verifiable infrastructure.',
    description:
      'AI & Open Web Lab is a working session rather than a lecture marathon. Small teams will examine trustworthy agent workflows, payment boundaries, and human approval patterns before assembling a lightweight prototype with mentors available throughout the afternoon.',
    age_restriction: '16+. Bring a laptop and charger.',
  },
  {
    name: 'Late Checkout: Studio Taping',
    organizer_display_name: 'Open City Collective',
    category: 'Comedy',
    start: '2026-08-12T20:00:00+05:30',
    end: '2026-08-12T22:00:00+05:30',
    capacity: 120,
    priceXlm: 20,
    venue: 'The Green Room',
    address: 'Demo Venue, Hauz Khas',
    city: 'Delhi',
    image: 'late-checkout-comedy.webp',
    summary:
      'A tightly curated studio comedy taping with sharp sets and no filler.',
    description:
      'Late Checkout brings four comics into a purpose-built studio for a paced, audience-first recording. Seating is close to the stage, entry is timed, and the show starts promptly so every set can be captured without interruptions.',
    age_restriction: '18+. Material may contain strong language.',
  },
  {
    name: 'Chai Break Comedy Room',
    organizer_display_name: 'Open City Collective',
    category: 'Comedy',
    start: '2026-09-05T19:30:00+05:30',
    end: '2026-09-05T21:30:00+05:30',
    capacity: 90,
    priceXlm: 10,
    venue: 'Courtyard Studio',
    address: 'Demo Venue, Koregaon Park',
    city: 'Pune',
    image: 'chai-break-comedy.webp',
    summary:
      'New jokes, familiar chaos, and a room small enough to hear every callback.',
    description:
      'Chai Break Comedy Room is a low-pressure showcase for touring comics testing new ideas alongside strong local acts. The compact format keeps the energy conversational, with a short chai interval between halves.',
    age_restriction: '18+. Material may contain strong language.',
  },
  {
    name: 'City Lights 5K',
    organizer_display_name: 'Open City Collective',
    category: 'Sports',
    start: '2026-08-16T18:00:00+05:30',
    end: '2026-08-16T21:00:00+05:30',
    capacity: 800,
    priceXlm: 5,
    venue: 'Marina Demo Course',
    address: 'Demo Start Line, Marina District',
    city: 'Chennai',
    image: 'city-lights-5k.webp',
    summary:
      'A timed evening 5K designed for first finishers, fast finishers, and everyone between.',
    description:
      'City Lights 5K follows a clearly marked waterfront-style course with staggered starts, hydration points, medical support, and a relaxed finish-zone meetup. Runners receive their wave and safety briefing at verified ticket check-in.',
    age_restriction:
      '14+. Participants under 18 need guardian consent.',
  },
  {
    name: 'Street Football Finals',
    organizer_display_name: 'Open City Collective',
    category: 'Sports',
    start: '2026-09-12T17:00:00+05:30',
    end: '2026-09-12T21:00:00+05:30',
    capacity: 128,
    priceXlm: 7,
    venue: 'East Yard Arena',
    address: 'Demo Venue, New Town',
    city: 'Kolkata',
    image: 'street-football-finals.webp',
    summary:
      'Four teams, one floodlit court, and a fast-format city final.',
    description:
      'Street Football Finals closes the season with two semifinals, a skills interval, and a winner-takes-the-night final. The compact court and close spectator line put the crowd inside every transition, save, and finish.',
    age_restriction:
      'All ages. Guests under 14 must be accompanied by an adult.',
  },
  {
    name: 'The Last Local',
    organizer_display_name: 'Open City Collective',
    category: 'Theater',
    start: '2026-08-30T19:00:00+05:30',
    end: '2026-08-30T21:30:00+05:30',
    capacity: 260,
    priceXlm: 30,
    venue: 'Platform Theatre',
    address: 'Demo Venue, Prabhadevi',
    city: 'Mumbai',
    image: 'the-last-local.webp',
    summary:
      'A city story told across one train compartment and one impossible final journey.',
    description:
      'The Last Local is an ensemble drama set during the final service of the night. As strangers negotiate missed connections and unfinished conversations, a transformable compartment becomes a moving portrait of the city outside.',
    age_restriction: '12+.',
  },
  {
    name: 'Paper Boats',
    organizer_display_name: 'Open City Collective',
    category: 'Theater',
    start: '2026-09-20T18:30:00+05:30',
    end: '2026-09-20T20:30:00+05:30',
    capacity: 180,
    priceXlm: 14,
    venue: 'Riverlight Theatre',
    address: 'Demo Venue, Mandi House',
    city: 'Delhi',
    image: 'paper-boats.webp',
    summary:
      'A quiet visual play about memory, distance, and the small things we send downstream.',
    description:
      'Paper Boats combines movement, miniature objects, live foley, and restrained projection to tell a story with very little spoken dialogue. The result is an accessible, reflective performance built for audiences who enjoy visual storytelling.',
    age_restriction: '8+. Family-friendly.',
  },
  {
    name: 'Goa Makers & Music Weekend',
    organizer_display_name: 'PulseGate Live',
    category: 'Festivals',
    start: '2026-10-03T10:00:00+05:30',
    end: '2026-10-04T21:00:00+05:30',
    capacity: 900,
    priceXlm: 35,
    venue: 'Coastline Commons',
    address: 'Demo Venue, North Goa',
    city: 'Goa',
    image: 'goa-makers-music.webp',
    summary:
      'Two days of independent craft, practical workshops, and sunset live sets.',
    description:
      'Goa Makers & Music Weekend brings small-batch makers, creative technologists, food pop-ups, and independent musicians into one walkable program. The ticket covers both days, including open demos and the evening performance stage.',
    age_restriction:
      'All ages. Guests under 16 must be accompanied by an adult.',
  },
  {
    name: 'Jaipur Food & Folk Evening',
    organizer_display_name: 'PulseGate Live',
    category: 'Festivals',
    start: '2026-10-17T16:00:00+05:30',
    end: '2026-10-17T22:00:00+05:30',
    capacity: 600,
    priceXlm: 9,
    venue: 'Amber Courtyard',
    address: 'Demo Venue, Amer Road',
    city: 'Jaipur',
    image: 'jaipur-food-folk.webp',
    summary:
      'Regional food, folk performance, and an open courtyard under the evening lights.',
    description:
      'Jaipur Food & Folk Evening is a relaxed cultural program pairing rotating folk ensembles with independently operated tasting counters. Short stage introductions give context to each performance without interrupting the informal courtyard atmosphere.',
    age_restriction: 'All ages.',
  },
  {
    name: 'PulseGate Demo Night: Live Entry',
    organizer_display_name: 'PulseGate Demo Ops',
    category: 'Tech',
    start: '2026-08-02T18:00:00+05:30',
    end: '2026-08-02T21:00:00+05:30',
    capacity: 40,
    priceXlm: 3,
    venue: 'Stellar Demo Hall',
    address: 'Demo Venue, Indiranagar',
    city: 'Bengaluru',
    image: 'pulsegate-demo-night.webp',
    summary:
      'A compact product night built around live ticket purchase, rotating QR, and verified entry.',
    description:
      'PulseGate Demo Night gives builders and judges a focused view of the full ticket lifecycle on Stellar Testnet. The evening includes a short architecture walkthrough followed by a live purchase, QR validation, and organizer-signed check-in demonstration.',
    age_restriction: '16+.',
  },
  {
    name: 'Monsoon Arena Showcase',
    organizer_display_name: 'PulseGate Live',
    category: 'Sports',
    start: '2026-09-26T17:00:00+05:30',
    end: '2026-09-26T21:00:00+05:30',
    capacity: 150,
    priceXlm: 16,
    venue: 'Monsoon Indoor Arena',
    address: 'Demo Venue, Balewadi',
    city: 'Pune',
    image: 'monsoon-arena-showcase.webp',
    summary:
      'An indoor multi-discipline showcase built for a loud crowd and unpredictable weather.',
    description:
      'Monsoon Arena Showcase combines short-format athletic challenges, demonstrations, and a final exhibition round inside a weatherproof venue. Timed entry keeps the concourse clear while verified digital tickets simplify access at each gate.',
    age_restriction:
      'All ages. Guests under 14 must be accompanied by an adult.',
  },
  {
    name: 'Open Stage Showcase',
    organizer_display_name: 'Open City Collective',
    category: 'Comedy',
    start: '2026-10-10T19:00:00+05:30',
    end: '2026-10-10T22:00:00+05:30',
    capacity: 80,
    priceXlm: 8,
    venue: 'Lantern Stage',
    address: 'Demo Venue, Bandra West',
    city: 'Mumbai',
    image: 'open-stage-showcase.webp',
    summary:
      'A welcoming open stage for short comedy, spoken word, and unexpected five-minute sets.',
    description:
      'Open Stage Showcase gives selected performers a strict five-minute slot in a well-produced room. The program moves quickly across comedy and spoken word, with a short interval and a closing set from the evening host.',
    age_restriction:
      '16+. Some material may contain strong language.',
  },
];

async function callPublication(action, input = {}) {
  const response = await fetch(
    `${config.supabaseUrl}/functions/v1/event-publication`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action, ...input }),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `${action} failed (${response.status}): ${payload.error ?? 'unknown error'}`,
    );
  }
  return payload;
}

function preparedIdentity(xdr) {
  const transaction = TransactionBuilder.fromXDR(
    xdr,
    config.networkPassphrase,
  );
  const maxTime = Number(transaction.timeBounds?.maxTime ?? 0);
  if (!maxTime) throw new Error('Prepared transaction has no maximum time.');
  return {
    unsignedEnvelopeHash: transaction.hash().toString('hex'),
    sourceSequence: transaction.sequence,
    transactionMaxTime: maxTime,
  };
}

async function publishEvent(event, index) {
  const { draft: initialDraft } = await callPublication('create-draft');
  const patch = {
    intended_organizer_address: organizerAddress,
    expected_name: event.name,
    expected_date_unix: unix(event.start),
    expected_capacity: event.capacity,
    expected_price_per_ticket: event.priceXlm * 10_000_000,
    summary: event.summary,
    description: event.description,
    image_url: `${imageBase}/${event.image}`,
    category: event.category,
    timezone: shared.timezone,
    end_unix: unix(event.end),
    venue: event.venue,
    address: event.address,
    city: event.city,
    organizer_display_name: event.organizer_display_name,
    support_contact: shared.support_contact,
    entry_instructions: shared.entry_instructions,
    accessibility_notes: shared.accessibility_notes,
    age_restriction: event.age_restriction,
    prohibited_items: shared.prohibited_items,
    map_url: shared.map_url,
    public_links: shared.public_links,
  };
  const { draft: savedDraft } = await callPublication('save-draft', {
    draftId: initialDraft.draft_id,
    expectedRevision: initialDraft.revision,
    patch,
  });
  const { preflight } = await callPublication('preflight-publication', {
    draftId: savedDraft.draft_id,
  });

  const transaction = await ticket.create_event({
    organizer: organizerAddress,
    event_id: preflight.eventId,
    name: event.name,
    date_unix: BigInt(patch.expected_date_unix),
    end_unix: BigInt(patch.end_unix),
    capacity: BigInt(event.capacity),
    price_per_ticket: BigInt(patch.expected_price_per_ticket),
  });
  let signingIdentity;
  const signTransaction = async (xdr, options) => {
    signingIdentity = preparedIdentity(xdr);
    await callPublication('begin-publication', {
      draftId: savedDraft.draft_id,
      ...signingIdentity,
    });
    const signed = await nodeSigner.signTransaction(xdr, options);
    const signedTransaction = TransactionBuilder.fromXDR(
      signed.signedTxXdr,
      config.networkPassphrase,
    );
    const signedTransactionHash = signedTransaction.hash().toString('hex');
    if (signedTransactionHash !== signingIdentity.unsignedEnvelopeHash) {
      throw new Error('Signed transaction identity changed unexpectedly.');
    }
    await callPublication('record-signed-publication', {
      draftId: savedDraft.draft_id,
      signedTransactionHash,
    });
    return signed;
  };

  const sent = await transaction.signAndSend({ signTransaction });
  const transactionHash = sent.sendTransactionResponse?.hash;
  if (!transactionHash) {
    throw new Error('Confirmed event transaction did not return its hash.');
  }

  let resolved;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    resolved = await callPublication('resolve-publication', {
      draftId: savedDraft.draft_id,
    });
    if (resolved.draft?.state === 'published') break;
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (resolved?.draft?.state !== 'published') {
    throw new Error(
      `Publication did not reach published state (${resolved?.draft?.state ?? 'unknown'}).`,
    );
  }
  console.log(
    `PUBLISHED ${index + 1}/${events.length} | ${event.name} | ${transactionHash}`,
  );
}

const { events: ownedEvents = [] } = await callPublication('list-owned-events');
const publishedNames = new Set(ownedEvents.map((event) => event.name));
const { drafts: incompleteDrafts = [] } = await callPublication('list-drafts');
const ignoredDuplicateEventIds = new Set([
  'evt_a2b25aa6633b4f71af2ca3fc42a4a9e4',
]);
for (const draft of incompleteDrafts) {
  if (ignoredDuplicateEventIds.has(draft.event_id)) {
    console.log(`IGNORED DUPLICATE | ${draft.expected_name}`);
    continue;
  }
  if (
    [
      'signed_submission_pending',
      'confirmation_pending',
      'status_unknown',
      'chain_created',
      'chain_confirmed',
      'sync_warning',
    ].includes(draft.state)
  ) {
    const action = ['chain_created', 'chain_confirmed', 'sync_warning'].includes(
      draft.state,
    )
      ? 'retry-publication-sync'
      : 'resolve-publication';
    const recovered = await callPublication(action, {
      draftId: draft.draft_id,
    });
    if (recovered.draft?.state === 'published' && draft.expected_name) {
      publishedNames.add(draft.expected_name);
      console.log(`RECOVERED | ${draft.expected_name}`);
    } else {
      throw new Error(
        `Could not recover ${draft.expected_name ?? draft.event_id} (${recovered.draft?.state ?? 'unknown'}).`,
      );
    }
    continue;
  }
  if (draft.state === 'approval_required' && !draft.signed_transaction_hash) {
    await callPublication('pre-submission-failed', {
      draftId: draft.draft_id,
      category: 'preparation_failed',
      detail: 'Superseded before submission by the corrected showcase publisher.',
    });
    await callPublication('delete-draft', { draftId: draft.draft_id });
  }
}

for (const [index, event] of events.entries()) {
  if (publishedNames.has(event.name)) {
    console.log(`SKIPPED ${index + 1}/${events.length} | ${event.name}`);
    continue;
  }
  await publishEvent(event, index);
}

console.log(`COMPLETE | organizer=${organizerAddress}`);
