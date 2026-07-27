import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../components/ui/Button';
import { useEvent } from '../hooks/useEvent';
import { useXlmPrice } from '../hooks/useXlmPrice';
import {
  authoritativeFingerprint,
  deriveEventSalesState,
  EVENT_SALES_LABELS,
  formatEventRange,
  REFUND_POLICY,
  remainingTickets,
  RESALE_POLICY,
} from '../lib/eventModel';
import {
  allocatePurchaseOperation,
  markPurchasePreparing,
  markPurchaseReviewReady,
  operationBoundPurchaseSigner,
  type PurchaseOperationResponse,
  recordPreparationFailure,
  requestTestFunding,
  resolvePurchaseOperation,
  savePurchaseRecovery,
} from '../lib/purchaseOperations';
import { prepareTicketPurchase, type PreparedTicketPurchase } from '../lib/soroban';
import {
  fetchXlmBalance,
  formatStroops,
  type StellarAccountBalance,
} from '../lib/stellar';
import { useAppStore } from '../store/useAppStore';

interface PurchasePageProps {
  eventId: string;
  onBack: () => void;
  onOpenReceipt: (operationId: string) => void;
}

const PAYABLE_STATES = new Set(['review', 'pre_submission_failed']);
const RECOVERY_STATES = new Set([
  'signed_submission_pending',
  'confirming',
  'status_unknown',
]);

/** Playwright-only state seeding; production builds cannot enable this path. */
const SCREENSHOT_REVIEW_STORAGE_KEY = 'stellar-tickets:screenshot-purchase-review';
const SCREENSHOT_ESTIMATED_FEE_STROOPS = 100_000n;
const SCREENSHOT_BALANCE_STROOPS = 500_000_000n;
const SCREENSHOT_ATTENDEE_ADDRESS = 'GBBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEEQSCIJBEFZSP';

function isScreenshotReviewMode(): boolean {
  return import.meta.env.DEV &&
    sessionStorage.getItem(SCREENSHOT_REVIEW_STORAGE_KEY) === 'ready';
}

function screenshotPurchaseOperation(
  eventId: string,
  attendeeWalletAddress: string,
): PurchaseOperationResponse {
  const timestamp = '2026-07-27T06:30:00.000Z';
  return {
    operation: {
      operation_id: '00000000-0000-4000-8000-000000000301',
      user_id: '00000000-0000-4000-8000-000000000302',
      request_idempotency_key: '00000000-0000-4000-8000-000000000303',
      ticket_id: 'ticket-seed-a-review-01',
      event_id: eventId,
      attendee_wallet_address: attendeeWalletAddress,
      expected_price_stroops: '180000000',
      estimated_fee_stroops: SCREENSHOT_ESTIMATED_FEE_STROOPS.toString(),
      confirmed_fee_stroops: null,
      network: 'StellarTestnet',
      ticket_contract_id: import.meta.env.VITE_TICKET_CONTRACT_ID as string,
      state: 'review',
      failure_category: null,
      failure_detail: null,
      current_attempt_number: 0,
      transaction_hash: null,
      ledger_sequence: null,
      ledger_closed_at: null,
      receipt_event_name: null,
      receipt_event_start_unix: null,
      receipt_event_timezone: null,
      receipt_venue: null,
      receipt_owner_address: null,
      receipt_amount_stroops: null,
      created_at: timestamp,
      updated_at: timestamp,
      confirmed_at: null,
    },
    attempt: null,
  };
}

function screenshotPreparedPurchase(): PreparedTicketPurchase {
  return {
    estimatedFeeStroops: SCREENSHOT_ESTIMATED_FEE_STROOPS,
    submit: async () => {
      throw new Error('Screenshot review mode cannot submit a transaction.');
    },
  };
}

export function PurchasePage({
  eventId,
  onBack,
  onOpenReceipt,
}: PurchasePageProps) {
  const { event, loading, error, reload } = useEvent(eventId);
  const wallet = useAppStore((state) => state.attendeeWallet);
  const { usdPerXlm } = useXlmPrice();
  const screenshotReview = isScreenshotReviewMode();
  const reviewedFingerprint = useRef<string | null>(null);
  const allocationKey = useRef(crypto.randomUUID());
  const preparingRef = useRef(false);
  const [operationResponse, setOperationResponse] =
    useState<PurchaseOperationResponse | null>(() =>
      screenshotReview
        ? screenshotPurchaseOperation(
            eventId,
            wallet.address ?? SCREENSHOT_ATTENDEE_ADDRESS,
          )
        : null,
    );
  const [prepared, setPrepared] = useState<PreparedTicketPurchase | null>(() =>
    screenshotReview ? screenshotPreparedPurchase() : null,
  );
  const [account, setAccount] = useState<StellarAccountBalance | null>(() =>
    screenshotReview
      ? { exists: true, balanceStroops: SCREENSHOT_BALANCE_STROOPS }
      : null,
  );
  const [balanceLoading, setBalanceLoading] = useState(false);
  const [fundingLoading, setFundingLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const operation = operationResponse?.operation ?? null;

  const refreshBalance = useCallback(async () => {
    if (screenshotReview || !wallet.address) return;
    setBalanceLoading(true);
    try {
      setAccount(await fetchXlmBalance(wallet.address));
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Balance lookup failed.');
    } finally {
      setBalanceLoading(false);
    }
  }, [screenshotReview, wallet.address]);

  useEffect(() => {
    const timeout = setTimeout(() => void refreshBalance(), 0);
    return () => clearTimeout(timeout);
  }, [refreshBalance]);

  useEffect(() => {
    if (
      screenshotReview ||
      !event ||
      deriveEventSalesState(event, undefined, true) !== 'on_sale' ||
      wallet.readiness !== 'ready' ||
      !wallet.address ||
      !account?.exists ||
      operationResponse
    ) {
      return;
    }
    let cancelled = false;
    void allocatePurchaseOperation(event.eventId, allocationKey.current)
      .then((response) => {
        if (cancelled) return;
        setOperationResponse(response);
        savePurchaseRecovery(response.operation);
        reviewedFingerprint.current = authoritativeFingerprint(event);
      })
      .catch((nextError) => {
        if (!cancelled) {
          setNotice(
            nextError instanceof Error
              ? nextError.message
              : 'The purchase operation could not be reserved.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    account?.exists,
    event,
    operationResponse,
    screenshotReview,
    wallet.address,
    wallet.readiness,
  ]);

  const prepareOperation = useCallback(async () => {
    if (
      !operation ||
      !event ||
      !wallet.address ||
      preparingRef.current ||
      !PAYABLE_STATES.has(operation.state)
    ) {
      return;
    }
    preparingRef.current = true;
    setPrepared(null);
    setNotice(null);
    try {
      const preparing = await markPurchasePreparing(operation.operation_id);
      setOperationResponse(preparing);
      const nextPrepared = await prepareTicketPurchase(
        event.eventId,
        wallet.address,
        operation.ticket_id,
      );
      const ready = await markPurchaseReviewReady(
        operation.operation_id,
        nextPrepared.estimatedFeeStroops,
      );
      setPrepared(nextPrepared);
      setOperationResponse(ready);
    } catch (nextError) {
      const detail = nextError instanceof Error
        ? nextError.message
        : 'Purchase preparation failed.';
      setNotice(detail);
      const failed = await recordPreparationFailure(operation.operation_id, detail)
        .catch(() => null);
      if (failed) setOperationResponse(failed);
    } finally {
      preparingRef.current = false;
    }
  }, [event, operation, wallet.address]);

  useEffect(() => {
    if (screenshotReview || operation?.state !== 'review' || prepared) return;
    const timeout = setTimeout(() => void prepareOperation(), 0);
    return () => clearTimeout(timeout);
  }, [operation?.state, prepareOperation, prepared, screenshotReview]);

  useEffect(() => {
    if (!operation || !RECOVERY_STATES.has(operation.state)) return;
    let cancelled = false;
    const resolve = async () => {
      try {
        const response = await resolvePurchaseOperation(operation.operation_id);
        if (!cancelled) {
          setOperationResponse(response);
          savePurchaseRecovery(response.operation);
        }
      } catch (nextError) {
        if (!cancelled) {
          setNotice(
            nextError instanceof Error
              ? nextError.message
              : 'Purchase status is temporarily unavailable.',
          );
        }
      }
    };
    void resolve();
    const interval = setInterval(() => void resolve(), 5_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [operation]);

  if (loading && !event) {
    return <div className="p-20 text-center text-slate-400">Checking current sale conditions…</div>;
  }
  if (error) return <div className="p-20 text-center text-red-400">{error}</div>;
  if (!event) return <div className="p-20 text-center text-slate-400">Published event not found.</div>;

  const salesState = deriveEventSalesState(event, undefined, true);
  const priceStroops = BigInt(event.pricePerTicket);
  const estimatedFeeStroops = prepared?.estimatedFeeStroops ??
    BigInt(operation?.estimated_fee_stroops ?? 0);
  const totalRequired = priceStroops + estimatedFeeStroops;
  const balance = account?.balanceStroops ?? 0n;
  const shortfall = totalRequired > balance ? totalRequired - balance : 0n;
  const remaining = balance > totalRequired ? balance - totalRequired : 0n;
  const totalUsd = usdPerXlm ? Number(formatStroops(totalRequired)) * usdPerXlm : null;

  const handleFunding = async () => {
    setFundingLoading(true);
    setNotice(null);
    try {
      const funded = await requestTestFunding();
      setAccount({ exists: funded.exists, balanceStroops: BigInt(funded.balanceStroops) });
      setNotice(
        funded.kind === 'activation'
          ? 'Your Testnet account is activated and funded.'
          : 'The demo Testnet top-up is confirmed.',
      );
    } catch (nextError) {
      setNotice(nextError instanceof Error ? nextError.message : 'Test funding failed.');
    } finally {
      setFundingLoading(false);
    }
  };

  const startNewOperation = () => {
    allocationKey.current = crypto.randomUUID();
    reviewedFingerprint.current = authoritativeFingerprint(event);
    setPrepared(null);
    setOperationResponse(null);
    setNotice(null);
  };

  const handlePurchase = async () => {
    if (
      !operation ||
      !prepared ||
      !wallet.address ||
      !wallet.signFn ||
      operation.state !== 'review' ||
      shortfall > 0n
    ) {
      return;
    }
    setWorking(true);
    setNotice(null);
    try {
      const refreshed = await reload();
      if (!refreshed) {
        setNotice('Current sale conditions could not be verified. No payment was submitted.');
        return;
      }
      const nextState = deriveEventSalesState(refreshed, undefined, true);
      const nextFingerprint = authoritativeFingerprint(refreshed);
      const reviewBaseline = reviewedFingerprint.current ?? authoritativeFingerprint(event);
      if (nextState !== 'on_sale') {
        reviewedFingerprint.current = nextFingerprint;
        setPrepared(null);
        setNotice(
          `The event is now ${EVENT_SALES_LABELS[nextState].toLowerCase()}. No payment was submitted.`,
        );
        return;
      }
      if (reviewBaseline !== nextFingerprint) {
        reviewedFingerprint.current = nextFingerprint;
        setPrepared(null);
        setNotice('Price or availability changed. Review the updated information, then confirm again.');
        return;
      }

      const boundSigner = operationBoundPurchaseSigner(
        operation,
        wallet.signFn,
        (response) => {
          setOperationResponse(response);
          savePurchaseRecovery(response.operation);
        },
      );
      await prepared.submit(boundSigner);
      const resolved = await resolvePurchaseOperation(operation.operation_id);
      setOperationResponse(resolved);
      savePurchaseRecovery(resolved.operation);
      if (['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(resolved.operation.state)) {
        onOpenReceipt(operation.operation_id);
      } else {
        setNotice('The transaction was signed, but its final status is still being verified.');
      }
    } catch (nextError) {
      const recovered = await resolvePurchaseOperation(operation.operation_id).catch(() => null);
      if (recovered) {
        setOperationResponse(recovered);
        savePurchaseRecovery(recovered.operation);
        if (['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(recovered.operation.state)) {
          onOpenReceipt(operation.operation_id);
          return;
        }
      }
      setNotice(
        nextError instanceof Error
          ? nextError.message
          : 'The purchase status is temporarily unavailable.',
      );
    } finally {
      setWorking(false);
    }
  };

  const stateMessage = operation ? purchaseStateMessage(operation.state) : null;
  const paymentDisabled =
    salesState !== 'on_sale' ||
    wallet.readiness !== 'ready' ||
    !prepared ||
    !operation ||
    operation.state !== 'review' ||
    shortfall > 0n ||
    working;

  return (
    <div className="bg-[#0E1113] min-h-screen text-[#EAEFF4]">
      <main className="pt-24 pb-32 px-4 md:px-8 max-w-4xl mx-auto">
        <div className="mb-8">
          <p className="text-sm font-semibold text-[#7C5CFF]">Review purchase</p>
          <h1 className="mt-2 text-3xl md:text-4xl font-bold">Buy 1 ticket</h1>
          <p className="mt-2 text-[#938ea1]">
            Sale conditions shown here were read from the TicketContract.
          </p>
        </div>

        <section className="bg-[#15181C] border border-[#272C33] rounded-lg overflow-hidden">
          <div className="grid md:grid-cols-[220px_1fr]">
            <img src={event.imageUrl} alt={event.name} className="w-full h-full min-h-52 object-cover" />
            <div className="p-6">
              <div className="flex flex-wrap gap-2 mb-3">
                <span className="rounded-full bg-[#7C5CFF]/15 px-3 py-1 text-xs text-[#cabeff]">
                  {EVENT_SALES_LABELS[salesState]}
                </span>
                <span className="rounded-full bg-[#272C33] px-3 py-1 text-xs">
                  {remainingTickets(event)} remaining
                </span>
              </div>
              <h2 className="text-2xl font-bold">{event.name}</h2>
              <p className="mt-3 text-sm text-[#c9c4d8]">{formatEventRange(event)}</p>
              <p className="mt-1 text-sm text-[#c9c4d8]">{event.venue} · {event.city}</p>
            </div>
          </div>
        </section>

        <section className="mt-6 bg-[#15181C] border border-[#272C33] rounded-lg p-6">
          <dl className="space-y-4 text-sm">
            <Line label="1 × General Admission ticket" value={`${formatStroops(priceStroops)} XLM`} />
            <Line
              label="Estimated network fee"
              value={prepared ? `${formatStroops(estimatedFeeStroops)} XLM` : 'Simulating…'}
            />
            <Line label="Total required" value={`${formatStroops(totalRequired)} XLM`} strong />
            <Line
              label="Available balance"
              value={balanceLoading ? 'Checking…' : `${formatStroops(balance)} XLM`}
            />
            {shortfall > 0n ? (
              <Line label="Shortfall" value={`${formatStroops(shortfall)} XLM`} warning />
            ) : (
              <Line label="Estimated remaining" value={`${formatStroops(remaining)} XLM`} />
            )}
          </dl>
          {totalUsd !== null && (
            <p className="mt-4 text-right text-xs text-[#938ea1]">
              Approx. ${totalUsd.toFixed(2)}
            </p>
          )}
        </section>

        <section className="mt-6 grid gap-4 md:grid-cols-2">
          <Policy title="Refunds" text={REFUND_POLICY[event.refundPolicyCode]} />
          <Policy title="Resale" text={RESALE_POLICY[event.resalePolicyCode]} />
        </section>

        {stateMessage && operation && operation.state !== 'review' && (
          <section aria-live="polite" className="mt-6 rounded-lg border border-[#7C5CFF]/30 bg-[#7C5CFF]/10 p-4">
            <p className="font-semibold">{stateMessage}</p>
            {operation.failure_detail && (
              <p className="mt-1 text-sm text-[#c9c4d8]">{operation.failure_detail}</p>
            )}
          </section>
        )}
        {notice && (
          <div className="mt-6 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
            {notice}
          </div>
        )}
        {salesState !== 'on_sale' && (
          <div className="mt-6 rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-red-100">
            This event is {EVENT_SALES_LABELS[salesState].toLowerCase()}; primary payment is disabled.
          </div>
        )}

        <p className="mt-6 text-xs text-[#938ea1]">
          Stellar Testnet — balances and payments have no monetary value.
        </p>

        <div className="mt-6 flex flex-col gap-3">
          {account && (!account.exists || shortfall > 0n) && (
            <Button
              onClick={() => void handleFunding()}
              disabled={fundingLoading}
              size="lg"
              className="w-full py-4"
            >
              {fundingLoading
                ? 'Requesting test funds…'
                : account.exists
                  ? 'Request demo Testnet top-up'
                  : 'Get test XLM'}
            </Button>
          )}
          {operation?.state === 'pre_submission_failed' && (
            <Button onClick={() => void prepareOperation()} size="lg" className="w-full py-4">
              Prepare safe retry
            </Button>
          )}
          {operation?.state === 'chain_failed' && (
            <Button onClick={startNewOperation} size="lg" className="w-full py-4">
              Start a new purchase attempt
            </Button>
          )}
          {operation && ['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(operation.state) ? (
            <Button
              onClick={() => onOpenReceipt(operation.operation_id)}
              size="lg"
              className="w-full py-4"
            >
              Open receipt
            </Button>
          ) : (
            <Button
              onClick={() => void handlePurchase()}
              disabled={paymentDisabled}
              size="lg"
              className="w-full py-4 text-lg"
            >
              {working
                ? 'Checking purchase status…'
                : `Confirm and pay ${formatStroops(totalRequired)} XLM`}
            </Button>
          )}
          <Button variant="secondary" onClick={onBack} size="lg" className="w-full py-4">
            Return to event
          </Button>
        </div>
      </main>
    </div>
  );
}

function purchaseStateMessage(state: string): string {
  switch (state) {
    case 'preparing': return 'Preparing purchase';
    case 'approval_required': return 'Waiting for passkey approval';
    case 'signed_submission_pending': return 'Submitting to Stellar';
    case 'confirming': return 'Confirming on-chain';
    case 'status_unknown': return 'Purchase status temporarily unavailable';
    case 'pre_submission_failed': return 'Nothing was submitted';
    case 'chain_failed': return 'Purchase rejected on Stellar';
    case 'chain_confirmed': return 'Ticket confirmed';
    default: return '';
  }
}

function Line({
  label,
  value,
  strong = false,
  warning = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
  warning?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-[#272C33] pb-4 last:border-0 last:pb-0">
      <dt className={strong ? 'font-semibold' : 'text-[#c9c4d8]'}>{label}</dt>
      <dd className={`text-right ${strong ? 'font-bold text-lg' : ''} ${warning ? 'text-amber-300' : ''}`}>
        {value}
      </dd>
    </div>
  );
}

function Policy({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-[#272C33] bg-[#15181C] p-5">
      <h2 className="font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-[#c9c4d8]">{text}</p>
    </div>
  );
}
