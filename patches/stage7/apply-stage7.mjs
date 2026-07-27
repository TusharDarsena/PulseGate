import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const manifestPath = resolve(root, 'frontend/e2e/screenshots/capture-manifest.ts');
const specPath = resolve(root, 'frontend/e2e/screenshots/capture.spec.ts');

const manifestEntry = `
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
`;

async function patchManifest() {
  let source = await readFile(manifestPath, 'utf8');
  if (source.includes("id: 'organizer-event-draft-ready-desktop'")) {
    console.log('Stage 7 manifest entry already present.');
    return;
  }
  const arrayEnd = source.lastIndexOf('\n];');
  if (arrayEnd < 0) {
    throw new Error('Could not find the SCREENSHOT_CAPTURES array terminator.');
  }
  source = `${source.slice(0, arrayEnd)}${manifestEntry}${source.slice(arrayEnd)}`;
  await writeFile(manifestPath, source);
  console.log('Added Stage 7 manifest entry.');
}

async function patchSpec() {
  let source = await readFile(specPath, 'utf8');
  const importLine = "import { installEventDraftReadyMocks } from './helpers/install-event-draft-mocks';";
  if (!source.includes(importLine)) {
    const importAnchor = "import { screenshotOutputPath } from './helpers/output-path';";
    if (!source.includes(importAnchor)) {
      throw new Error('Could not find the screenshot output-path import anchor.');
    }
    source = source.replace(importAnchor, `${importLine}\n${importAnchor}`);
  }

  if (!source.includes("capture.id === 'organizer-event-draft-ready-desktop'")) {
    const fallback = /    \} else \{\r?\n      throw new Error\(`No fixture installer exists for screenshot capture: \$\{capture\.id\}`\);\r?\n    \}/;
    if (!fallback.test(source)) {
      throw new Error('Could not find the fixture-dispatch fallback in capture.spec.ts.');
    }
    source = source.replace(
      fallback,
      `    } else if (capture.id === 'organizer-event-draft-ready-desktop') {\n      await installEventDraftReadyMocks(page);\n    } else {\n      throw new Error(\`No fixture installer exists for screenshot capture: \${capture.id}\`);\n    }`,
    );
  }

  await writeFile(specPath, source);
  console.log('Added Stage 7 runner dispatch.');
}

await patchManifest();
await patchSpec();
console.log('Stage 7 patch applied without replacing existing captures.');
