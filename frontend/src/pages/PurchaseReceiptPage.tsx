import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { EventActions } from '../components/events/EventActions';
import { Button } from '../components/ui/Button';
import { usePublishedEventsByIds } from '../hooks/useScopedEvents';
import {
  getPurchaseOperation,
  resolvePurchaseOperation,
  retryPurchaseSync,
  savePurchaseRecovery,
  type PurchaseOperationResponse,
} from '../lib/purchaseOperations';
import { STELLAR_EXPLORER_URL } from '../lib/constants';
import { formatStroops } from '../lib/stellar';
import { userFacingError } from '../lib/utils';

const UNRESOLVED = new Set([
  'signed_submission_pending',
  'confirming',
  'status_unknown',
]);
const SYNC_PENDING = new Set(['chain_confirmed', 'mirror_syncing', 'sync_warning']);

export function PurchaseReceiptPage() {
  const { operationId = '' } = useParams();
  const navigate = useNavigate();
  const [response, setResponse] = useState<PurchaseOperationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const operation = response?.operation ?? null;
  const eventState = usePublishedEventsByIds(operation ? [operation.event_id] : []);

  const load = useCallback(async (resolve = false) => {
    if (!operationId) return;
    setError(null);
    try {
      const next = resolve
        ? await resolvePurchaseOperation(operationId)
        : await getPurchaseOperation(operationId);
      setResponse(next);
      savePurchaseRecovery(next.operation);
    } catch (nextError) {
      setError(userFacingError(nextError, 'Receipt unavailable.'));
    } finally {
      setLoading(false);
    }
  }, [operationId]);

  useEffect(() => {
    const timeout = setTimeout(() => void load(), 0);
    return () => clearTimeout(timeout);
  }, [load]);

  useEffect(() => {
    if (!operation || !UNRESOLVED.has(operation.state)) return;
    const interval = setInterval(() => void load(true), 5_000);
    return () => clearInterval(interval);
  }, [load, operation]);

  if (loading) {
    return <main className="pt-28 min-h-screen text-center text-slate-400">Loading receipt…</main>;
  }
  if (error || !operation) {
    return (
      <main className="pt-28 min-h-screen px-4 text-center text-red-300">
        {error || 'Receipt not found for this account.'}
      </main>
    );
  }

  const confirmed = ['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(operation.state);
  const event = eventState.events[0];
  const amount = BigInt(operation.receipt_amount_stroops ?? operation.expected_price_stroops);
  const fee = BigInt(operation.confirmed_fee_stroops ?? operation.estimated_fee_stroops);

  return (
    <main className="pt-28 pb-28 px-4 max-w-3xl mx-auto min-h-screen">
      <p className="text-sm font-semibold text-[#7C5CFF]">Purchase receipt</p>
      <h1 className="mt-2 text-3xl md:text-4xl font-bold">
        {confirmed ? (operation.state === 'complete' ? 'Your ticket is ready' : 'Your purchase is confirmed') : receiptStateHeading(operation.state)}
      </h1>
      <p className="mt-3 text-[#c9c4d8]">
        {confirmed
          ? 'This receipt is backed by the immutable TicketContract purchase event.'
          : 'A second payment is disabled while this operation is unresolved.'}
      </p>

      <section className="mt-8 border border-[#272C33] bg-[#15181C] rounded-lg overflow-hidden">
        <div className="p-6 border-b border-[#272C33]">
          <p className="text-xs uppercase text-[#938ea1]">Event</p>
          <h2 className="mt-1 text-2xl font-bold">
            {operation.receipt_event_name || event?.name || 'Reserved event'}
          </h2>
          {operation.receipt_event_start_unix && (
            <p className="mt-2 text-sm text-[#c9c4d8]">
              {formatReceiptDate(
                operation.receipt_event_start_unix,
                operation.receipt_event_timezone || 'UTC',
              )}
            </p>
          )}
          <p className="mt-1 text-sm text-[#c9c4d8]">
            {operation.receipt_venue || event?.venue}
          </p>
        </div>
        <dl className="p-6 grid gap-5 sm:grid-cols-2 text-sm">
          <ReceiptFact label="Ticket" value="1 × General Admission" />
          <ReceiptFact label="Amount paid" value={`${formatStroops(amount)} XLM`} />
          <ReceiptFact
            label={operation.confirmed_fee_stroops !== null ? 'Network fee' : 'Estimated network fee'}
            value={`${formatStroops(fee)} XLM`}
          />
          <ReceiptFact label="Total debited" value={`${formatStroops(amount + fee)} XLM`} />
          <ReceiptFact label="Network" value="Stellar Testnet" />
          <ReceiptFact label="Ticket ID" value={operation.ticket_id} mono />
          <ReceiptFact
            label="Owner at purchase"
            value={operation.receipt_owner_address || operation.attendee_wallet_address}
            mono
          />
          {operation.transaction_hash && (
            <ReceiptFact label="Transaction hash" value={operation.transaction_hash} mono />
          )}
          {operation.ledger_sequence && (
            <ReceiptFact label="Ledger" value={String(operation.ledger_sequence)} />
          )}
          {operation.ledger_closed_at && (
            <ReceiptFact
              label="Confirmed"
              value={new Date(operation.ledger_closed_at).toLocaleString()}
            />
          )}
          <ReceiptFact
            label="Ticket library"
            value={operation.state === 'complete' ? 'Available in My Tickets' : 'Synchronization pending'}
          />
        </dl>
      </section>

      {operation.failure_detail && !confirmed && (
        <div className="mt-6 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
          {userFacingError(operation.failure_detail, 'Transaction status is still being checked.')}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-3">
        {UNRESOLVED.has(operation.state) && (
          <Button onClick={() => void load(true)}>Check status</Button>
        )}
        {SYNC_PENDING.has(operation.state) && (
          <Button onClick={() => void retryPurchaseSync(operation.operation_id).then(setResponse).catch((e) => setError(userFacingError(e, 'Ticket synchronization is delayed.')))}>
            Retry ticket sync
          </Button>
        )}
        {operation.state === 'complete' && (
          <Button onClick={() => navigate(`/tickets/${operation.ticket_id}`)}>View ticket</Button>
        )}
        {operation.transaction_hash && (
          <a
            href={`${STELLAR_EXPLORER_URL}/tx/${operation.transaction_hash}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg border border-[#36333e] px-4 py-2 text-sm hover:border-[#7C5CFF]"
          >
            View transaction
          </a>
        )}
        <Button variant="secondary" onClick={() => navigate('/events')}>Back to events</Button>
      </div>

      {confirmed && event && (
        <section className="mt-8 border-t border-[#272C33] pt-6">
          <h2 className="mb-3 text-lg font-semibold">Event actions</h2>
          <EventActions event={event} />
        </section>
      )}
    </main>
  );
}

function receiptStateHeading(state: string) {
  switch (state) {
    case 'pre_submission_failed': return 'Nothing was submitted';
    case 'chain_failed': return 'Purchase rejected';
    case 'status_unknown': return 'Purchase status unavailable';
    default: return 'Purchase confirmation pending';
  }
}

function formatReceiptDate(unix: number, timeZone: string) {
  return new Date(unix * 1000).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone,
    timeZoneName: 'short',
  });
}

function ReceiptFact({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs uppercase text-[#938ea1]">{label}</dt>
      <dd className={`mt-1 break-words ${mono ? 'font-mono text-xs text-[#cabeff]' : ''}`}>
        {value}
      </dd>
    </div>
  );
}
