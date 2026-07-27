import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, 'frontend/e2e/screenshots/capture-manifest.ts');
const specPath = resolve(root, 'frontend/e2e/screenshots/capture.spec.ts');

const entries = [
  {
    id: 'organizer-dashboard-populated-desktop',
    source: `
  {
    id: 'organizer-dashboard-populated-desktop',
    tier: 2,
    page: 'organizer-dashboard',
    state: 'populated',
    route: '/organizer/events',
    role: 'organizer',
    data: 'seedA',
    version: 'v01',
    viewportName: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    folder: ['02-tier-2-support-flow', 'organizer-dashboard'],
    readyText: 'Organizer Hub',
    visibleTexts: [
      'Private drafts',
      'Published events',
      'Indie After Dark',
      'Midnight Frequency',
      'Manage Event',
      'Create event',
    ],
    purpose: 'Represents the populated organizer dashboard where organizers can find drafts, published events, and management actions.',
    reviewFocus: 'Review information hierarchy, draft and published-event separation, metrics, recency and status readability, Manage Event prominence, desktop density, navigation, clipping, and overflow.',
  },
`,
  },
  {
    id: 'auth-default-mobile',
    source: `
  {
    id: 'auth-default-mobile',
    tier: 3,
    page: 'auth',
    state: 'default',
    route: '/auth',
    role: 'guest',
    data: 'seedA',
    version: 'v01',
    viewportName: 'mobile-390x844',
    viewport: { width: 390, height: 844 },
    folder: ['03-tier-3-edge-flow', 'auth'],
    readyText: 'Sign in',
    visibleTexts: [
      'Continue with Google or a six-digit email code.',
      'Continue with Google',
      'Send email code',
    ],
    purpose: 'Represents the default mobile onboarding surface for signing in through Google or email OTP.',
    reviewFocus: 'Review sign-in hierarchy, provider choice clarity, email-field usability, CTA prominence, mobile spacing, keyboard-safe layout, header treatment, disclosure placement, clipping, and overflow.',
  },
`,
  },
  {
    id: 'create-event-preparing-desktop',
    source: `
  {
    id: 'create-event-preparing-desktop',
    tier: 3,
    page: 'create-event',
    state: 'preparing',
    route: '/organizer/events/new',
    role: 'organizer',
    data: 'seedA',
    version: 'v01',
    viewportName: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    folder: ['03-tier-3-edge-flow', 'create-event'],
    readyText: 'Preparing your private draft…',
    visibleTexts: [
      'A stable event ID is reserved now.',
      'Nothing is published or submitted to Stellar.',
    ],
    purpose: 'Represents the organizer transition while a private draft and stable future event ID are being prepared.',
    reviewFocus: 'Review loading-state hierarchy, truthful explanation of what is and is not happening, header and back navigation, desktop centering, excessive empty space, clipping, and false-success cues.',
  },
`,
  },
  {
    id: 'not-found-default-desktop',
    source: `
  {
    id: 'not-found-default-desktop',
    tier: 3,
    page: 'not-found',
    state: 'default',
    route: '/not-found/screenshot-seed-a',
    role: 'guest',
    data: 'seedA',
    version: 'v01',
    viewportName: 'desktop-1440x900',
    viewport: { width: 1440, height: 900 },
    folder: ['03-tier-3-edge-flow', 'not-found'],
    readyText: 'Page not found',
    visibleTexts: [
      'StellarTickets',
      'Discover',
      'Marketplace',
      'My Tickets',
      'Account',
    ],
    purpose: 'Represents the default application response for an unknown durable route.',
    reviewFocus: 'Review 404 hierarchy, recovery through persistent navigation, empty-space balance, testnet disclosure, desktop alignment, clipping, and whether the page gives sufficient next direction.',
  },
`,
  },
];

async function patchManifest() {
  let source = await readFile(manifestPath, 'utf8');

  if (!source.includes('readonly visibleTexts')) {
    const anchor = '  readonly readyText: string;';
    if (!source.includes(anchor)) {
      throw new Error('Could not find readyText in ScreenshotCapture.');
    }
    source = source.replace(
      anchor,
      `${anchor}\n  readonly visibleTexts?: readonly string[];\n  readonly visibleLabels?: readonly string[];`,
    );
  }

  const missingEntries = entries.filter((entry) => !source.includes(`id: '${entry.id}'`));
  if (missingEntries.length === 0) {
    console.log('All four manifest entries are already present.');
  } else {
    const arrayEnd = source.lastIndexOf('\n];');
    if (arrayEnd < 0) {
      throw new Error('Could not find the SCREENSHOT_CAPTURES array terminator.');
    }
    const insertion = missingEntries.map((entry) => entry.source).join('');
    source = `${source.slice(0, arrayEnd)}${insertion}${source.slice(arrayEnd)}`;
    await writeFile(manifestPath, source);
    console.log(`Added ${missingEntries.length} screenshot manifest entr${missingEntries.length === 1 ? 'y' : 'ies'}.`);
  }
}

async function patchSpec() {
  let source = await readFile(specPath, 'utf8');
  const importLine = `import {
  installAuthDefaultMocks,
  installCreateEventPreparingMocks,
  installNotFoundMocks,
  installOrganizerDashboardPopulatedMocks,
} from './helpers/install-tier2-tier3-mocks';`;

  if (!source.includes("from './helpers/install-tier2-tier3-mocks'")) {
    const importAnchor = "import { screenshotOutputPath } from './helpers/output-path';";
    if (!source.includes(importAnchor)) {
      throw new Error('Could not find the screenshot output-path import anchor.');
    }
    source = source.replace(importAnchor, `${importLine}\n${importAnchor}`);
  }

  const branches = [
    [
      'organizer-dashboard-populated-desktop',
      'installOrganizerDashboardPopulatedMocks',
    ],
    ['auth-default-mobile', 'installAuthDefaultMocks'],
    ['create-event-preparing-desktop', 'installCreateEventPreparingMocks'],
    ['not-found-default-desktop', 'installNotFoundMocks'],
  ];

  for (const [id, installer] of branches) {
    if (source.includes(`capture.id === '${id}'`)) continue;
    const fallback = /    \} else \{\r?\n      throw new Error\(`No fixture installer exists for screenshot capture: \$\{capture\.id\}`\);\r?\n    \}/;
    if (!fallback.test(source)) {
      throw new Error(`Could not find fixture-dispatch fallback while adding ${id}.`);
    }
    source = source.replace(
      fallback,
      `    } else if (capture.id === '${id}') {\n      await ${installer}(page);\n    } else {\n      throw new Error(\`No fixture installer exists for screenshot capture: \${capture.id}\`);\n    }`,
    );
  }

  const oldBrowseAssertions = `    await expect(page.getByText('Midnight Frequency')).toBeVisible();\n    await expect(page.getByText('Builders on Stellar')).toBeVisible();`;
  if (source.includes(oldBrowseAssertions)) {
    source = source.replace(
      oldBrowseAssertions,
      `    for (const text of capture.visibleTexts ?? []) {\n      await expect(page.getByText(text, { exact: false }).first()).toBeVisible();\n    }\n    for (const label of capture.visibleLabels ?? []) {\n      await expect(page.getByLabel(label)).toBeVisible();\n    }`,
    );
  }

  await writeFile(specPath, source);
  console.log('Added all four fixture dispatch branches without replacing existing captures.');
}

await patchManifest();
await patchSpec();
console.log('Tier 2/Tier 3 four-capture patch applied.');
