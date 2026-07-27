import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ScreenshotCapture } from '../capture-manifest';
import { captureRootPath, screenshotFilename } from './output-path';

function escapeCell(value: string): string {
  return value.replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export async function writeCaptureCatalog(
  captures: readonly ScreenshotCapture[],
): Promise<void> {
  const rows = captures.map((capture) => {
    const relativePath = [...capture.folder, screenshotFilename(capture)].join('/');
    return `| \`${escapeCell(relativePath)}\` | \`${escapeCell(capture.route)}\` | ${escapeCell(capture.purpose)} | ${escapeCell(capture.reviewFocus)} |`;
  });

  const content = [
    '# UI Refinement Screenshot Catalog',
    '',
    'Generated from `frontend/e2e/screenshots/capture-manifest.ts`.',
    '',
    '| Screenshot | Route | What it represents | What to review |',
    '|---|---|---|---|',
    ...rows,
    '',
  ].join('\n');

  await writeFile(path.join(captureRootPath(), 'CAPTURE-CATALOG.md'), content, 'utf8');
}