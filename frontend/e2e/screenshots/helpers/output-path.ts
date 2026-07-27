import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { CAPTURE_DATE, type ScreenshotCapture } from '../capture-manifest';

function requireFrontendWorkingDirectory(): string {
  const cwd = process.cwd();
  if (path.basename(cwd) !== 'frontend') {
    throw new Error(
      `Run the screenshot command from the frontend directory. Current directory: ${cwd}`,
    );
  }
  return cwd;
}

export function screenshotFilename(capture: ScreenshotCapture): string {
  return [
    `T${capture.tier}`,
    capture.page,
    capture.state,
    capture.viewportName,
    capture.role,
    capture.data,
    capture.version,
  ].join('_') + '.png';
}

export async function screenshotOutputPath(
  capture: ScreenshotCapture,
): Promise<string> {
  const frontendDirectory = requireFrontendWorkingDirectory();
  const directory = path.resolve(
    frontendDirectory,
    '..',
    'screenshots',
    'ui-refinement',
    CAPTURE_DATE,
    ...capture.folder,
  );

  await mkdir(directory, { recursive: true });
  return path.join(directory, screenshotFilename(capture));
}

export function captureRootPath(): string {
  const frontendDirectory = requireFrontendWorkingDirectory();
  return path.resolve(
    frontendDirectory,
    '..',
    'screenshots',
    'ui-refinement',
    CAPTURE_DATE,
  );
}