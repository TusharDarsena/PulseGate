export const CAPTURE_DATE = '2026-07-27';

export type ScreenshotRole = 'guest' | 'attendee' | 'organizer';
export type ScreenshotViewportName = 'mobile-390x844' | 'desktop-1440x900';

export interface ScreenshotCapture {
  readonly id: string;
  readonly tier: 1 | 2 | 3;
  readonly page: string;
  readonly state: string;
  readonly route: string;
  readonly role: ScreenshotRole;
  readonly data: string;
  readonly version: `v${number}`;
  readonly viewportName: ScreenshotViewportName;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly fixedTime?: string;
  readonly folder: readonly string[];
  readonly readyText: string;
  readonly visibleTexts: readonly string[];
  readonly visibleLabels?: readonly string[];
  readonly scrollToText?: string;
  readonly purpose: string;
  readonly reviewFocus: string;
}

/**
 * Captures are added one at a time after the previous state is proven stable.
 */
export const SCREENSHOT_CAPTURES: readonly ScreenshotCapture[] = [
  {
    id: 'browse-ready-desktop',
    tier: 1,
    page: 'browse',
    state: 'ready',
    route: '/events',
    role: 'guest',
    data: 'seedA',
    version: 'v01',
    viewportName: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    folder: ['01-tier-1-core-flow', 'browse'],
    readyText: 'Explore Experiences',
    visibleTexts: ['Midnight Frequency', 'Builders on Stellar'],
    purpose: 'Represents the public discovery surface with a populated event grid.',
    reviewFocus: 'Review page hierarchy, event-card consistency, navigation, filter density, and desktop spacing.',
  },
  {
    id: 'event-detail-ready-mobile',
    tier: 1,
    page: 'event-detail',
    state: 'ready',
    route: '/events/event-seed-a-01',
    role: 'guest',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    folder: ['01-tier-1-core-flow', 'event-detail'],
    readyText: 'Midnight Frequency',
    visibleTexts: ['On sale', 'The Foundry', '18.00', 'Buy 1 ticket'],
    visibleLabels: ['Go back'],
    purpose: 'Represents the public mobile event-detail surface when an event is available for purchase.',
    reviewFocus: 'Review event-information hierarchy; date, venue, price and availability readability; purchase CTA placement and visibility; mobile header and back navigation; clipping, overflow, and hidden content.',
  },
  {
    id: 'purchase-review-ready-mobile',
    tier: 1,
    page: 'purchase',
    state: 'review-ready',
    route: '/events/event-seed-a-01/checkout',
    role: 'attendee',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    folder: ['01-tier-1-core-flow', 'purchase'],
    readyText: 'Buy 1 ticket',
    visibleTexts: [
      'Midnight Frequency',
      '1 × General Admission ticket',
      'Estimated network fee',
      'Total required',
      'Available balance',
      'Estimated remaining',
      'Confirm and pay 18.01 XLM',
    ],
    visibleLabels: ['Go back'],
    scrollToText: 'Confirm and pay 18.01 XLM',
    purpose: 'Represents the authenticated mobile checkout review after the ticket price, simulated fee, balance, and policies are ready for confirmation.',
    reviewFocus: 'Review purchase-summary hierarchy, fee and total clarity, balance and remaining-funds readability, policy comprehension, confirmation CTA prominence, mobile spacing, and clipping or overflow.',
  },
  {
    id: 'purchase-receipt-confirmed-mobile',
    tier: 1,
    page: 'purchase-receipt',
    state: 'confirmed',
    route: '/purchases/00000000-0000-4000-8000-000000000401',
    role: 'attendee',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    folder: ['01-tier-1-core-flow', 'purchase-receipt'],
    readyText: 'Your ticket is confirmed',
    visibleTexts: [
      'Purchase receipt',
      'Midnight Frequency',
      '1 × General Admission',
      'Amount paid',
      '18.00 XLM',
      'Network fee',
      '0.01 XLM',
      'Available in My Tickets',
      'View ticket',
      'View transaction',
    ],
    purpose: 'Represents the authenticated mobile receipt after a primary ticket purchase is confirmed and synchronized into My Tickets.',
    reviewFocus: 'Review confirmation hierarchy, event identity, amount and fee clarity, receipt-fact scanning, transaction provenance, next-action prominence, mobile navigation, and clipping or overflow.',
  },

  {
    id: 'my-tickets-upcoming-mobile',
    tier: 1,
    page: 'my-tickets',
    state: 'upcoming',
    route: '/tickets',
    role: 'attendee',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    folder: ['01-tier-1-core-flow', 'my-tickets'],
    readyText: 'My Tickets',
    visibleTexts: [
      'UPCOMING',
      'GENERAL ADMISSION',
      'Midnight Frequency',
      'The Foundry',
      'VIEW TICKET',
      'VIEW RECEIPT',
      'SHOW QR',
      'LIST FOR SALE',
    ],
    scrollToText: 'VIEW TICKET',
    purpose: 'Represents the authenticated mobile My Tickets surface with a synchronized upcoming ticket ready for viewing, receipt access, QR entry, or resale.',
    reviewFocus: 'Review upcoming-tab clarity, ticket-card hierarchy, event date and venue readability, ticket identity treatment, primary and secondary action priority, mobile navigation, spacing, clipping, and overflow.',
  },

  {
    id: 'scanner-ready-mobile',
    tier: 1,
    page: 'scanner',
    state: 'ready',
    route: '/organizer/events/event-seed-a-01/check-in',
    role: 'organizer',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    fixedTime: '2026-09-12T18:15:00+05:30',
    folder: ['01-tier-1-core-flow', 'scanner'],
    readyText: 'Door Status',
    visibleTexts: [
      'Midnight Frequency',
      'Ready for check-in',
      'Door Status',
      'Sold',
      '214',
      'Checked in',
      '37',
      'Remaining',
      '177',
      'Organizer Wallet',
      'Connected:',
      'Scanner',
      'Enable camera',
    ],
    visibleLabels: ['Go back'],
    scrollToText: 'Enable camera',
    purpose: 'Represents the authenticated organizer mobile check-in surface after ownership, authoritative event status, the door window, and the matching wallet are confirmed, before camera activation.',
    reviewFocus: 'Review ready-for-check-in status, door statistics, organizer-wallet confirmation, camera CTA prominence, mobile panel stacking, spacing, clipping, and overflow.',
  },

  {
    id: 'organizer-event-draft-ready-desktop',
    tier: 1,
    page: 'organizer-event-draft',
    state: 'ready',
    route: '/organizer/drafts/draft-seed-a-07',
    role: 'organizer',
    data: 'seedA',
    version: 'v01',
    viewportName: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    folder: ['01-tier-1-core-flow', 'organizer-event-draft'],
    readyText: 'Midnight Frequency',
    visibleTexts: [
      'Private event workspace',
      'Revision 4 · Saved',
      'Public event information',
      'Delete draft',
      'Save draft',
    ],
    visibleLabels: [
      'Event name',
      'Short summary',
      'Full description',
      'Poster URL',
      'Category',
    ],
    purpose: 'Represents a signed-in organizer reopening a populated, saved event draft in its stable editable workspace.',
    reviewFocus: 'Review draft hierarchy, saved-state clarity, edit and delete action prominence, form grouping, field density, desktop spacing, back navigation, and clipping or overflow.',
  },

];
