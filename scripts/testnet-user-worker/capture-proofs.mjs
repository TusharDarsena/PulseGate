import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";

const frontendRequire = createRequire(
  new URL("../../frontend/package.json", import.meta.url),
);
const { chromium } = frontendRequire("@playwright/test");

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`Invalid argument sequence near ${key ?? "<end>"}`);
    }
    parsed[key.slice(2)] = value;
  }
  if (!parsed.state || !parsed.output) {
    throw new Error("Usage: capture-proofs.mjs --state <state.json> --output <proof-directory>");
  }
  return parsed;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function screenshotIsUsable(filePath) {
  if (!existsSync(filePath)) return false;
  const details = await stat(filePath);
  return details.size >= 20_000;
}

async function openIndexedPage(page, url, evidenceFragment, label) {
  let lastError;
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 45_000,
      });
      if (response && response.status() >= 400) {
        throw new Error(`HTTP ${response.status()}`);
      }

      await page.waitForFunction(
        (fragment) => document.body?.innerText?.toLowerCase().includes(fragment.toLowerCase()),
        evidenceFragment,
        { timeout: 20_000 },
      );
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => undefined);
      await page.evaluate(() => window.scrollTo(0, 0));
      await sleep(1_500);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 10) {
        await sleep(Math.min(30_000, attempt * 4_000));
      }
    }
  }
  throw new Error(`${label} was not indexed after retries: ${lastError?.message ?? lastError}`);
}

async function captureActor(browser, actor, state, screenshotsDirectory) {
  const accountFile = path.join(screenshotsDirectory, `${actor.id}-account.png`);
  const activityFile = path.join(screenshotsDirectory, `${actor.id}-activity.png`);
  const accountUrl = `${state.explorerBaseUrl}/account/${actor.address}`;
  const transactionUrl = `${state.explorerBaseUrl}/tx/${actor.proofTxHash}`;
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    colorScheme: "dark",
    locale: "en-US",
    timezoneId: "UTC",
  });
  const page = await context.newPage();

  try {
    if (!(await screenshotIsUsable(accountFile))) {
      await openIndexedPage(page, accountUrl, actor.address.slice(0, 12), `${actor.id} account`);
      await page.screenshot({ path: accountFile, fullPage: false });
    }

    if (!(await screenshotIsUsable(activityFile))) {
      await openIndexedPage(
        page,
        transactionUrl,
        actor.proofTxHash.slice(0, 12),
        `${actor.id} transaction`,
      );
      await page.screenshot({ path: activityFile, fullPage: false });
    }
  } finally {
    await context.close();
  }

  return {
    ...actor,
    accountUrl,
    transactionUrl,
    accountImage: `screenshots/${path.basename(accountFile)}`,
    activityImage: `screenshots/${path.basename(activityFile)}`,
  };
}

async function runPool(items, limit, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, consume));
  return results;
}

function markdownFor(state, actors) {
  const lines = [
    `# ${actors.length} Stellar Testnet Users`,
    "",
    "> These accounts and their activity were created and operated by the project's automated Stellar Testnet worker for hackathon testing. They are not Mainnet accounts or Supabase/Dfns identities.",
    "",
    `- **Network:** Stellar Testnet`,
    `- **Run:** \`${state.runId}\``,
    `- **TicketContract:** [\`${state.ticketContractId}\`](${state.explorerBaseUrl}/contract/${state.ticketContractId})`,
    `- **MarketplaceContract:** [\`${state.marketplaceContractId}\`](${state.explorerBaseUrl}/contract/${state.marketplaceContractId})`,
    "",
    "The entries below are ordered by worker user number. Account addresses, transactions, and network timestamps are unchanged.",
    "",
  ];

  for (const actor of actors) {
    const activityLabel =
      actor.activityRole === "listing-sold"
        ? "Marketplace listing created (paired resale purchase shown separately)"
        : actor.proofActivityLabel || "Confirmed contract transaction";
    lines.push(
      `## User ${String(actor.index).padStart(2, "0")}`,
      "",
      `**Address:** \`${actor.address}\`  `,
      `**Activity shown:** ${activityLabel}  `,
      `[Verify account](${actor.accountUrl}) | [Verify activity](${actor.transactionUrl})`,
      "",
      `![User ${String(actor.index).padStart(2, "0")} account proof](${actor.accountImage})`,
      "",
      `![User ${String(actor.index).padStart(2, "0")} activity proof](${actor.activityImage})`,
      "",
    );
  }

  return `${lines.join("\n")}\n`;
}

const args = parseArguments(process.argv.slice(2));
const statePath = path.resolve(args.state);
const outputDirectory = path.resolve(args.output);
const screenshotsDirectory = path.join(outputDirectory, "screenshots");
await mkdir(screenshotsDirectory, { recursive: true });

const stateText = await readFile(statePath, "utf8");
const state = JSON.parse(stateText.replace(/^\uFEFF/, ""));
if (state.networkPassphrase !== "Test SDF Network ; September 2015") {
  throw new Error("Screenshot network fuse rejected a non-Testnet state file.");
}
if (!String(state.explorerBaseUrl).endsWith("/testnet")) {
  throw new Error("Screenshot network fuse rejected a non-Testnet explorer.");
}

const actors = [...state.actors];
if (!actors.length || actors.some((actor) => !actor.address || !actor.proofTxHash)) {
  throw new Error("Every account needs an address and confirmed proof transaction before capture.");
}

const browser = await chromium.launch({ headless: true });
let captured;
try {
  captured = await runPool(actors, 3, (actor) =>
    captureActor(browser, actor, state, screenshotsDirectory),
  );
} finally {
  await browser.close();
}

for (const actor of captured) {
  const accountPath = path.join(outputDirectory, actor.accountImage);
  const activityPath = path.join(outputDirectory, actor.activityImage);
  if (!(await screenshotIsUsable(accountPath)) || !(await screenshotIsUsable(activityPath))) {
    throw new Error(`Missing or undersized proof image for ${actor.id}`);
  }
}

const presentationOrder = [...captured].sort(
  (left, right) => Number(left.index) - Number(right.index),
);
const readme = markdownFor(state, presentationOrder);
await writeFile(path.join(outputDirectory, "README.md"), readme, "utf8");

process.stdout.write(
  `Captured ${captured.length * 2} screenshots and wrote ${path.join(outputDirectory, "README.md")}\n`,
);
