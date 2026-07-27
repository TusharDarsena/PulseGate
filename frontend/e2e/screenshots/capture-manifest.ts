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
  readonly purpose: string;
  readonly reviewFocus: string;
}

/**
 * Step 1 intentionally contains one screenshot only.
 * New captures should be added here one at a time after the previous state is proven stable.
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
    purpose: 'Represents the public discovery surface with a populated event grid.',
    reviewFocus: 'Review page hierarchy, event-card consistency, navigation, filter density, and desktop spacing.',
  },
];