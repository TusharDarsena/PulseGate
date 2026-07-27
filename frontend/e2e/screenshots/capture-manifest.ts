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
  readonly folder: readonly string[];
  readonly readyText: string;
  readonly visibleTexts: readonly string[];
  readonly visibleLabels?: readonly string[];
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
];
