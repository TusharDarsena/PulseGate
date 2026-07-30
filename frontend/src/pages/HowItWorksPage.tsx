import { Link } from 'react-router-dom';
import {
  MARKETPLACE_CONTRACT_ID,
  STELLAR_EXPLORER_URL,
  TICKET_CONTRACT_ID,
} from '../lib/constants';

const REPOSITORY_URL = 'https://github.com/TusharDarsena/stellar_ticket';
const DEMO_VIDEO_URL = 'https://www.youtube.com/watch?v=0vL_UVSGT3I';

const LIFECYCLE = [
  {
    icon: 'campaign',
    title: 'Publish',
    detail: 'An organizer signs the event creation transaction with Freighter.',
  },
  {
    icon: 'confirmation_number',
    title: 'Purchase',
    detail: 'A recoverable attendee wallet buys one ticket while XLM is held in contract escrow.',
  },
  {
    icon: 'swap_horiz',
    title: 'Resale or refund',
    detail: 'Eligible resale uses the marketplace contract. Cancelled events unlock pull-based refunds.',
  },
  {
    icon: 'qr_code_scanner',
    title: 'QR entry',
    detail: 'A fresh signed QR is checked against current ownership and Active status before check-in.',
  },
  {
    icon: 'payments',
    title: 'Fund release',
    detail: 'After the event, the organizer releases escrow through the ticket contract.',
  },
] as const;

const ATTENDEE_STEPS = [
  'Sign in and prepare or recover your delegated Testnet wallet.',
  'Browse a published event and review current contract-verified availability.',
  'Approve the purchase, keep the receipt, and use My Tickets for recovery.',
  'At the venue, open a rotating QR that is revalidated before every signature.',
] as const;

const ORGANIZER_STEPS = [
  'Sign in, connect the event organizer’s Freighter wallet, and create a draft.',
  'Review metadata before publishing the event on Stellar.',
  'Open the event’s check-in route during the door window.',
  'Scan a fresh attendee QR and wait for the organizer-signed check-in confirmation.',
] as const;

export function HowItWorksPage() {
  const ticketExplorer = `${STELLAR_EXPLORER_URL}/contract/${TICKET_CONTRACT_ID}`;
  const marketplaceExplorer = `${STELLAR_EXPLORER_URL}/contract/${MARKETPLACE_CONTRACT_ID}`;

  return (
    <main className="min-h-screen px-4 pb-28 pt-24 md:px-8">
      <div className="mx-auto max-w-6xl">
        <section className="max-w-4xl py-8 md:py-14">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#cabeff]">
            How PulseGate works
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight md:text-6xl">
            Ticket truth lives on Stellar.
          </h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-[#c9c4d8]">
            PulseGate keeps discovery quick while contract reads and confirmed transactions
            control purchases, resale, refunds, venue entry, and fund release.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link
              to="/events"
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-[#7C5CFF] px-5 py-3 text-sm font-semibold text-white"
            >
              Browse attendee flow
            </Link>
            <Link
              to="/organizer/events"
              className="inline-flex min-h-11 items-center justify-center rounded-lg border border-[#484555] px-5 py-3 text-sm font-semibold text-[#e6e0ee]"
            >
              Start organizer flow
            </Link>
          </div>
        </section>

        <section aria-labelledby="lifecycle-heading">
          <h2 id="lifecycle-heading" className="text-2xl font-semibold">The ticket lifecycle</h2>
          <ol className="mt-5 grid gap-4 md:grid-cols-5">
            {LIFECYCLE.map((step, index) => (
              <li key={step.title} className="rounded-xl border border-[#272C33] bg-[#15181C] p-5">
                <div className="flex items-center justify-between">
                  <span className="material-symbols-outlined text-[#cabeff]" aria-hidden="true">
                    {step.icon}
                  </span>
                  <span className="text-xs font-semibold text-[#938ea1]">{index + 1}/5</span>
                </div>
                <h3 className="mt-5 font-semibold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#c9c4d8]">{step.detail}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className="mt-12 grid gap-5 md:grid-cols-2" aria-label="System authority">
          <AuthorityCard
            title="What Stellar controls"
            icon="shield"
            items={[
              'Event lifecycle, price, capacity, and current supply',
              'Ticket ownership and Active, Used, or Refunded status',
              'Escrow, refunds, restricted transfer, royalties, and fund release',
              'Organizer-authorized venue check-in',
            ]}
          />
          <AuthorityCard
            title="What Supabase accelerates"
            icon="speed"
            items={[
              'Authentication and server-side delegated-wallet coordination',
              'Published-event, ticket, and listing discovery',
              'Durable operation recovery and receipt presentation',
              'Mirrors updated only after contract confirmation',
            ]}
          />
        </section>

        <section className="mt-12 grid gap-5 lg:grid-cols-2" aria-label="Role walkthroughs">
          <Walkthrough title="Attendee walkthrough" steps={ATTENDEE_STEPS} />
          <Walkthrough title="Organizer walkthrough" steps={ORGANIZER_STEPS} />
        </section>

        <section className="mt-12 rounded-xl border border-[#272C33] bg-[#15181C] p-6 md:p-8">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <p className="text-sm font-semibold text-[#cabeff]">Current network</p>
              <h2 className="mt-1 text-2xl font-semibold">Stellar Testnet</h2>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-amber-200">
                Testnet XLM has no monetary value. This deployment is for evaluation and
                demonstration, not real-money ticket sales.
              </p>
            </div>
            <span className="w-fit rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-xs font-semibold text-amber-100">
              Testnet
            </span>
          </div>
          <dl className="mt-7 grid gap-5 md:grid-cols-2">
            <ContractLink label="Ticket contract" contractId={TICKET_CONTRACT_ID} href={ticketExplorer} />
            <ContractLink
              label="Marketplace contract"
              contractId={MARKETPLACE_CONTRACT_ID}
              href={marketplaceExplorer}
            />
          </dl>
        </section>

        <section className="mt-12" aria-labelledby="evidence-heading">
          <h2 id="evidence-heading" className="text-2xl font-semibold">Inspect the evidence</h2>
          <p className="mt-2 max-w-3xl text-[#c9c4d8]">
            Explore the public product overview, inspect the current contract source, or watch
            the complete product walkthrough.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <ExternalLink href={`${REPOSITORY_URL}#ascii-architecture-diagram`}>System architecture</ExternalLink>
            <ExternalLink href={`${REPOSITORY_URL}/tree/main/contracts`}>Contract source</ExternalLink>
            <ExternalLink href={DEMO_VIDEO_URL}>Walkthrough video</ExternalLink>
            <ExternalLink href={`${REPOSITORY_URL}#what-attendees-can-do`}>Product features</ExternalLink>
          </div>
        </section>
      </div>
    </main>
  );
}

function AuthorityCard({
  title,
  icon,
  items,
}: {
  title: string;
  icon: string;
  items: readonly string[];
}) {
  return (
    <article className="rounded-xl border border-[#272C33] bg-[#15181C] p-6">
      <span className="material-symbols-outlined text-[#cabeff]" aria-hidden="true">{icon}</span>
      <h2 className="mt-4 text-xl font-semibold">{title}</h2>
      <ul className="mt-4 space-y-3 text-sm text-[#c9c4d8]">
        {items.map((item) => (
          <li key={item} className="flex gap-2">
            <span aria-hidden="true" className="text-[#7C5CFF]">•</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </article>
  );
}

function Walkthrough({ title, steps }: { title: string; steps: readonly string[] }) {
  return (
    <article className="rounded-xl border border-[#272C33] bg-[#15181C] p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ol className="mt-5 space-y-4">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3 text-sm text-[#c9c4d8]">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#7C5CFF]/15 text-xs font-bold text-[#cabeff]">
              {index + 1}
            </span>
            <span className="pt-1">{step}</span>
          </li>
        ))}
      </ol>
    </article>
  );
}

function ContractLink({
  label,
  contractId,
  href,
}: {
  label: string;
  contractId: string;
  href: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold uppercase tracking-wider text-[#938ea1]">{label}</dt>
      <dd className="mt-2">
        <a
          href={href}
          target="_blank"
          rel="noreferrer"
          className="block break-all font-mono text-xs text-[#cabeff] hover:underline"
        >
          {contractId}
        </a>
      </dd>
    </div>
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center rounded-lg border border-[#484555] px-4 py-2 text-sm font-semibold text-[#cabeff] hover:border-[#7C5CFF]"
    >
      {children}
      <span className="material-symbols-outlined ml-2 text-[16px]" aria-hidden="true">open_in_new</span>
    </a>
  );
}
