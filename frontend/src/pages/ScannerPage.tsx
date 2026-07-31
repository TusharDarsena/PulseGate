import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useParams } from 'react-router-dom';
import { useEvent } from '../hooks/useEvent';
import { useWallet } from '../hooks/useWallet';
import { formatEventRange } from '../lib/eventModel';
import { verifyQRPayload } from '../lib/qr';
import { getAuthoritativeTicket, prepareMarkUsed } from '../lib/soroban';
import {
  getMyOrganizerEvent,
  invokeCheckInOperation,
  type CheckInOperation,
  type CheckInStats,
  type OwnedOrganizerEvent,
} from '../lib/supabase';
import { useAppStore } from '../store/useAppStore';
import { truncateKey, xlmToStroops, type Event } from '../types';
import { AuthorityStatus } from '../components/ui/AuthorityStatus';

type CameraState = 'idle' | 'starting' | 'running' | 'paused' | 'blocked' | 'unavailable';

type ScanResultKind =
  | 'confirmed'
  | 'expired'
  | 'invalid_qr'
  | 'not_found'
  | 'wrong_event'
  | 'transferred'
  | 'refunded'
  | 'already_used'
  | 'wrong_wallet'
  | 'status_unavailable'
  | 'status_unknown'
  | 'chain_failed'
  | 'sync_warning';

interface ScanResult {
  kind: ScanResultKind;
  ticketId?: string;
  walletAddress?: string;
  operation?: CheckInOperation;
  detail?: string;
}

const PENDING_STATES = ['signed_submission_pending', 'confirmation_pending', 'status_unknown'];
const CONFIRMED_STATES = ['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'];

export function ScannerPage() {
  const { eventId = '' } = useParams();
  const wallet = useAppStore((state) => state.organizerWallet);
  const { connectOrganizer, verifyOrganizer } = useWallet();
  const {
    event,
    loading: chainLoading,
    error: chainError,
    reload: reloadChainState,
  } = useEvent(eventId);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const processingRef = useRef(false);
  const processScanRef = useRef<(raw: string) => void>(() => undefined);
  const [owned, setOwned] = useState<OwnedOrganizerEvent | null>(null);
  const [ownershipLoading, setOwnershipLoading] = useState(true);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);
  const [cameraState, setCameraState] = useState<CameraState>('idle');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState<CheckInStats>({
    sold: 0,
    checkedIn: 0,
    remaining: 0,
    unresolved: 0,
  });
  const [operations, setOperations] = useState<CheckInOperation[]>([]);
  const [nowUnix, setNowUnix] = useState(() => Math.floor(Date.now() / 1000));

  const opensAt = event ? event.dateUnix - 7_200 : null;
  const withinWindow = Boolean(event && opensAt !== null && nowUnix >= opensAt && nowUnix < event.endUnix);
  const walletMatches = Boolean(event && wallet.publicKey && wallet.publicKey === event.organizer);
  const scannerReady = Boolean(
    owned &&
      event &&
      event.authority === 'confirmed' &&
      event.status === 'Active' &&
      withinWindow &&
      wallet.isConnected &&
      wallet.signFn &&
      walletMatches &&
      owned.organizer_address === event.organizer,
  );
  const unresolvedOperation = useMemo(
    () => operations.find((operation) => PENDING_STATES.includes(operation.state)),
    [operations],
  );

  const rememberOperation = (operation: CheckInOperation) => {
    setOperations((current) => [
      operation,
      ...current.filter((item) => item.operation_id !== operation.operation_id),
    ]);
  };

  const refreshStats = React.useCallback(async () => {
    if (!eventId || !owned) return;
    try {
      const payload = await invokeCheckInOperation('stats', { eventId });
      if (payload.stats) setStats(payload.stats);
    } catch {
      setStats((current) => ({ ...current, unresolved: current.unresolved }));
    }
  }, [eventId, owned]);

  const recheckScannerAuthority = React.useCallback(async () => {
    const nextEvent = await reloadChainState();
    const currentUnix = Math.floor(Date.now() / 1000);
    if (
      !owned ||
      !nextEvent ||
      nextEvent.eventId !== eventId ||
      nextEvent.authority !== 'confirmed' ||
      nextEvent.status !== 'Active' ||
      nextEvent.organizer !== owned.organizer_address
    ) {
      throw new Error('Authoritative organizer event access is no longer available.');
    }
    if (currentUnix < nextEvent.dateUnix - 7_200 || currentUnix >= nextEvent.endUnix) {
      throw new Error('Check-in is not currently open for this event.');
    }
    const organizerWallet = await verifyOrganizer(nextEvent.organizer);
    if (!organizerWallet.signFn || organizerWallet.publicKey !== nextEvent.organizer) {
      throw new Error('Freighter signing is not ready for this organizer wallet.');
    }
    return { event: nextEvent, organizerWallet };
  }, [eventId, owned, reloadChainState, verifyOrganizer]);

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setOwnershipLoading(true);
      setOwnershipError(null);
      void getMyOrganizerEvent(eventId)
        .then((next) => {
          if (active) setOwned(next);
        })
        .catch((error) => {
          if (active) {
            setOwned(null);
            setOwnershipError(error instanceof Error ? error.message : 'Could not verify event ownership.');
          }
        })
        .finally(() => {
          if (active) setOwnershipLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [eventId]);

  useEffect(() => {
    if (!owned) return;
    const timeout = setTimeout(() => {
      void invokeCheckInOperation('list', { eventId })
        .then((payload) => setOperations(payload.operations ?? []))
        .catch(() => setOperations([]));
      void refreshStats();
    }, 0);
    return () => clearTimeout(timeout);
  }, [eventId, owned, refreshStats]);

  useEffect(() => () => {
    if (scannerRef.current?.isScanning) {
      scannerRef.current.stop().catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (scannerReady || !scannerRef.current?.isScanning) return;
    scannerRef.current.pause(true);
    setCameraState((current) => current === 'running' ? 'paused' : current);
  }, [scannerReady]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowUnix(Math.floor(Date.now() / 1000));
      void reloadChainState();
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [reloadChainState]);

  const stopCamera = async () => {
    if (scannerRef.current?.isScanning) {
      await scannerRef.current.stop().catch(() => undefined);
    }
    setCameraState('idle');
  };

  const resumeScanning = async () => {
    try {
      await recheckScannerAuthority();
      setScanResult(null);
      processingRef.current = false;
      if (scannerRef.current?.isScanning) {
        scannerRef.current.resume();
        setCameraState('running');
      }
    } catch (error) {
      setScanResult({
        kind: 'status_unavailable',
        detail: error instanceof Error ? error.message : 'Check-in authorization must be verified again.',
      });
      setCameraState('paused');
    }
  };

  const showResult = (result: ScanResult) => {
    setScanResult(result);
    setCameraState((current) => current === 'running' ? 'paused' : current);
  };

  const processScan = React.useCallback(async (raw: string) => {
    if (processingRef.current || !event || !wallet.publicKey || !wallet.signFn || !scannerReady) return;
    processingRef.current = true;
    setBusy(true);
    setScanResult(null);
    if (scannerRef.current?.isScanning) {
      scannerRef.current.pause(true);
      setCameraState('paused');
    }

    let operationId: string | null = null;
    let signedHashPersisted = false;
    let transactionPrepared = false;

    try {
      if (!walletMatches) {
        showResult({ kind: 'wrong_wallet', detail: `Switch to ${truncateKey(event.organizer)}.` });
        return;
      }

      const parsed = verifyQRPayload(raw);
      if (!parsed.ok) {
        showResult({ kind: parsed.reason === 'expired' ? 'expired' : 'invalid_qr' });
        return;
      }

      let ticketRead;
      try {
        ticketRead = await getAuthoritativeTicket(parsed.ticketId);
      } catch (error) {
        showResult({
          kind: 'status_unavailable',
          ticketId: parsed.ticketId,
          walletAddress: parsed.walletAddress,
          detail: error instanceof Error ? error.message : 'Ticket status unavailable.',
        });
        return;
      }

      if (ticketRead.kind === 'not_found') {
        showResult({ kind: 'not_found', ticketId: parsed.ticketId });
        return;
      }

      const { ticket } = ticketRead;
      if (ticket.eventId !== eventId) {
        showResult({ kind: 'wrong_event', ticketId: parsed.ticketId });
        return;
      }
      if (ticket.status === 'Refunded') {
        showResult({ kind: 'refunded', ticketId: parsed.ticketId });
        return;
      }
      if (ticket.status === 'Used') {
        showResult({ kind: 'already_used', ticketId: parsed.ticketId });
        return;
      }
      if (ticket.owner !== parsed.walletAddress) {
        showResult({
          kind: 'transferred',
          ticketId: parsed.ticketId,
          walletAddress: parsed.walletAddress,
        });
        return;
      }

      const { event: verifiedEvent, organizerWallet } = await recheckScannerAuthority();

      const allocated = await invokeCheckInOperation('allocate', {
        idempotencyKey: crypto.randomUUID(),
        eventId,
        ticketId: parsed.ticketId,
        expectedOwnerAddress: parsed.walletAddress,
      });
      if (!allocated.operation) throw new Error('The check-in operation was not allocated.');
      operationId = allocated.operation.operation_id;
      rememberOperation(allocated.operation);

      if (PENDING_STATES.includes(allocated.operation.state)) {
        showResult({ kind: 'status_unknown', operation: allocated.operation, ticketId: parsed.ticketId });
        return;
      }
      if (CONFIRMED_STATES.includes(allocated.operation.state)) {
        showResult({
          kind: allocated.operation.state === 'sync_warning' ? 'sync_warning' : 'confirmed',
          operation: allocated.operation,
          ticketId: parsed.ticketId,
          walletAddress: parsed.walletAddress,
        });
        await refreshStats();
        return;
      }

      if (organizerWallet.accountExists !== true) {
        throw new Error(
          'The organizer Freighter account is not activated on Stellar Testnet. Fund it with Friendbot, then reconnect Freighter.',
        );
      }

      const transaction = await prepareMarkUsed(
        eventId,
        parsed.ticketId,
        parsed.walletAddress,
        verifiedEvent.organizer,
      );
      if (
        organizerWallet.xlmBalance === null ||
        xlmToStroops(Number(organizerWallet.xlmBalance)) < transaction.estimatedFeeStroops
      ) {
        throw new Error('The organizer wallet does not have enough XLM for the network fee.');
      }
      transactionPrepared = true;

      const begun = await invokeCheckInOperation('begin-attempt', {
        operationId,
        ...transaction.identity,
      });
      if (begun.operation) rememberOperation(begun.operation);

      await transaction.submit(organizerWallet.signFn!, async ({ signedTransactionHash }) => {
        const signed = await invokeCheckInOperation('record-signed-attempt', {
          operationId,
          signedTransactionHash,
        });
        if (!signed.operation) throw new Error('The signed check-in was not persisted.');
        signedHashPersisted = true;
        rememberOperation(signed.operation);
      });

      const resolved = await invokeCheckInOperation('resolve', { operationId });
      if (resolved.operation) {
        rememberOperation(resolved.operation);
        showResult({
          kind: resolved.operation.state === 'sync_warning' ? 'sync_warning' : 'confirmed',
          operation: resolved.operation,
          ticketId: parsed.ticketId,
          walletAddress: parsed.walletAddress,
        });
        await Promise.all([reloadChainState(), refreshStats()]);
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Check-in failed.';
      if (operationId) {
        try {
          if (signedHashPersisted) {
            const unresolved = await invokeCheckInOperation('resolve', { operationId });
            if (unresolved.operation) {
              rememberOperation(unresolved.operation);
              showResult({
                kind: unresolved.operation.state === 'chain_failed' ? 'chain_failed' : 'status_unknown',
                operation: unresolved.operation,
                detail,
              });
              return;
            }
          } else {
            const failed = await invokeCheckInOperation('pre-submission-failed', {
              operationId,
              category: transactionPrepared && /reject|declin|cancel/i.test(detail)
                ? 'approval_rejected'
                : transactionPrepared
                  ? 'signing_provider_failed'
                  : 'preparation_failed',
              detail,
            });
            if (failed.operation) rememberOperation(failed.operation);
          }
        } catch {
          // The durable operation remains recoverable from this scanner route.
        }
      }
      showResult({ kind: 'chain_failed', detail });
    } finally {
      setBusy(false);
    }
  }, [
    event,
    eventId,
    refreshStats,
    recheckScannerAuthority,
    reloadChainState,
    scannerReady,
    wallet.publicKey,
    wallet.signFn,
    walletMatches,
  ]);

  useEffect(() => {
    processScanRef.current = (raw) => {
      void processScan(raw);
    };
  }, [processScan]);

  const onScanSuccess = React.useCallback((decodedText: string) => {
    processScanRef.current(decodedText);
  }, []);

  const enableCamera = async () => {
    if (!scannerReady || cameraState === 'starting' || cameraState === 'running') return;
    setCameraState('starting');
    setScanResult(null);
    try {
      scannerRef.current ??= new Html5Qrcode('qr-reader');
      await scannerRef.current.start(
        { facingMode: 'environment' },
        { fps: 10, qrbox: { width: 260, height: 260 } },
        onScanSuccess,
        () => undefined,
      );
      setCameraState('running');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCameraState(/permission|notallowed|denied/i.test(message) ? 'blocked' : 'unavailable');
    }
  };

  const resolveOperation = async (operation: CheckInOperation) => {
    setBusy(true);
    try {
      const payload = await invokeCheckInOperation(
        operation.state === 'sync_warning' ? 'retry-sync' : 'resolve',
        { operationId: operation.operation_id },
      );
      if (payload.operation) {
        rememberOperation(payload.operation);
        showResult({
          kind: payload.operation.state === 'chain_failed'
            ? 'chain_failed'
            : payload.operation.state === 'status_unknown'
              ? 'status_unknown'
              : payload.operation.state === 'sync_warning'
                ? 'sync_warning'
                : 'confirmed',
          operation: payload.operation,
          ticketId: payload.operation.ticket_id,
          walletAddress: payload.operation.expected_owner_address,
        });
        await refreshStats();
      }
    } catch (error) {
      showResult({
        kind: 'status_unknown',
        operation,
        detail: error instanceof Error ? error.message : 'Could not resolve operation.',
      });
    } finally {
      setBusy(false);
    }
  };

  if (ownershipLoading) {
    return <main className="min-h-screen pt-28 text-center text-slate-400"><p>Organizer Hub · Check-in</p><p className="mt-3">Verifying organizer access...</p></main>;
  }
  if (!owned) {
    return (
      <main className="min-h-screen pt-28 px-4 text-center">
        <p className="text-sm text-[#cabeff]">Organizer Hub · Check-in</p><h1 className="mt-2 text-3xl font-bold">Event unavailable</h1>
        <p className="mt-3 text-slate-400">
          {ownershipError ?? 'This event does not exist or is not owned by your signed-in account.'}
        </p>
        {!ownershipError && <a href="/organizer/events" className="mt-5 inline-block text-[#cabeff]">Organizer Hub</a>}
      </main>
    );
  }
  if (chainLoading) return <main className="min-h-screen pt-28 text-center"><p>Organizer Hub · Check-in</p><p className="mt-3">Loading authoritative event state...</p></main>;
  if (!event) return <main className="min-h-screen pt-28 text-center"><p>Organizer Hub · Check-in</p><p className="mt-3">{chainError ?? 'Event status unavailable.'}</p>{!chainError && <a href="/organizer/events" className="mt-5 inline-block text-[#cabeff]">Organizer Hub</a>}</main>;

  const gate = scannerGate({
    event,
    walletConnected: wallet.isConnected && Boolean(wallet.signFn),
    walletMatches,
    withinWindow,
    opensAt,
    nowUnix,
  });

  return (
    <main className="min-h-screen bg-[#0E1113] pt-24 pb-28 text-[#e6e0ee]">
      <div className="mx-auto mb-4 max-w-6xl px-4 text-sm text-[#cabeff]">Organizer Hub · {event.name} · Check-in</div>
      <section className="mx-auto grid max-w-6xl gap-6 px-4 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-h-[70vh] overflow-hidden rounded-xl border border-[#272C33] bg-black">
          <div className="relative h-[68vh] min-h-[34rem]">
            <div id="qr-reader" className="absolute inset-0 [&>video]:h-full [&>video]:w-full [&>video]:object-cover" />
            {cameraState !== 'running' && (
              <div className="absolute inset-0 flex items-center justify-center bg-neutral-950">
                <div className="text-center">
                  <span className="material-symbols-outlined text-7xl text-[#7C5CFF]">qr_code_scanner</span>
                  <p className="mt-3 text-lg font-semibold">{gate.title}</p>
                  <p className="mt-2 max-w-md text-sm text-slate-400">{gate.detail}</p>
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-72 w-72 border-2 border-[#7C5CFF] shadow-[0_0_30px_rgba(124,92,255,0.35)]" />
            </div>
            <div className="absolute left-4 right-4 top-4 rounded-lg border border-[#343941] bg-[#15181C]/90 p-4 backdrop-blur">
              <p className="text-sm font-semibold">{event.name}</p>
              <p className="text-xs text-slate-400">{event.venue} · {formatEventRange(event)}</p>
            </div>
          </div>
        </div>

        <aside className="space-y-4">
          <Panel title="Door Status">
            <AuthorityStatus
              state={event.authority === 'confirmed' ? 'confirmed' : 'unavailable'}
              message={
                event.authority === 'confirmed'
                  ? 'Current event, organizer, and door-window inputs were read from Stellar. Camera access follows the checks below.'
                  : 'Current event state could not be verified. Check-in is disabled.'
              }
              className="mb-4"
            />
            <p className="text-sm text-slate-300">{gate.title}</p>
            <p className="mt-2 text-xs text-slate-500">{gate.detail}</p>
            <dl className="mt-4 space-y-2 text-sm">
              <Metric label="Sold" value={String(stats.sold || event.currentSupply)} />
              <Metric label="Checked in" value={String(stats.checkedIn)} />
              <Metric label="Remaining" value={String(stats.remaining || Math.max(event.currentSupply - stats.checkedIn, 0))} />
              <Metric label="Unresolved" value={String(stats.unresolved)} />
            </dl>
          </Panel>

          <Panel title="Organizer Wallet">
            <p className="break-all font-mono text-xs text-slate-300">{event.organizer}</p>
            {!wallet.isConnected ? (
              <button type="button" onClick={() => void connectOrganizer()} className="mt-4 w-full rounded-lg bg-[#7C5CFF] px-4 py-3 font-semibold">
                Connect Freighter
              </button>
            ) : (
              <p className={walletMatches ? 'mt-3 text-sm text-emerald-300' : 'mt-3 text-sm text-amber-200'}>
                Connected: {wallet.publicKey ? truncateKey(wallet.publicKey) : 'Unknown'}
              </p>
            )}
          </Panel>

          <Panel title="Scanner">
            <button
              type="button"
              onClick={() => void enableCamera()}
              disabled={!scannerReady || cameraState === 'starting' || cameraState === 'running' || busy}
              className="w-full rounded-lg bg-[#7C5CFF] px-4 py-3 font-semibold disabled:opacity-40"
            >
              {cameraState === 'starting' ? 'Starting camera...' : 'Enable camera'}
            </button>
            {cameraState === 'running' && (
              <button type="button" onClick={() => void stopCamera()} className="mt-3 w-full rounded-lg border border-[#343941] px-4 py-3">
                Stop camera
              </button>
            )}
            {cameraState === 'blocked' && <p className="mt-3 text-sm text-amber-200">Camera access blocked. Retry permission or adjust browser settings.</p>}
            {cameraState === 'unavailable' && <p className="mt-3 text-sm text-amber-200">Camera unavailable. Use another supported device.</p>}
            {unresolvedOperation && (
              <button
                type="button"
                onClick={() => void resolveOperation(unresolvedOperation)}
                disabled={busy}
                className="mt-3 w-full rounded-lg border border-amber-400/40 px-4 py-3 text-amber-100 disabled:opacity-40"
              >
                Resolve pending check-in
              </button>
            )}
          </Panel>
        </aside>
      </section>

      {scanResult && (
        <ResultOverlay
          result={scanResult}
          busy={busy}
          onNext={() => void resumeScanning()}
          onResolve={scanResult.operation ? () => void resolveOperation(scanResult.operation!) : undefined}
        />
      )}
    </main>
  );
}

function scannerGate({
  event,
  walletConnected,
  walletMatches,
  withinWindow,
  opensAt,
  nowUnix,
}: {
  event: Event;
  walletConnected: boolean;
  walletMatches: boolean;
  withinWindow: boolean;
  opensAt: number | null;
  nowUnix: number;
}) {
  if (event.authority !== 'confirmed') {
    return { title: 'Event status unavailable', detail: event.authorityError ?? 'Retry authoritative read.' };
  }
  if (event.status === 'Cancelled') return { title: 'Event cancelled', detail: 'No check-ins are permitted.' };
  if (event.status === 'Completed') return { title: 'Event completed', detail: 'No check-ins are permitted.' };
  if (!walletConnected) return { title: 'Organizer wallet required', detail: 'Connect Freighter before scanning.' };
  if (!walletMatches) return { title: 'Wrong organizer wallet', detail: `Switch to ${truncateKey(event.organizer)}.` };
  if (opensAt !== null && nowUnix < opensAt) {
    return { title: `Check-in opens at ${new Date(opensAt * 1000).toLocaleString()}`, detail: 'Camera remains disabled until the door window opens.' };
  }
  if (!withinWindow || nowUnix >= event.endUnix) return { title: 'Check-in closed', detail: 'No new check-in transactions may be submitted.' };
  return { title: 'Ready for check-in', detail: 'Enable the camera to scan attendee QR codes.' };
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#272C33] bg-[#15181C] p-5">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

function ResultOverlay({
  result,
  busy,
  onNext,
  onResolve,
}: {
  result: ScanResult;
  busy: boolean;
  onNext: () => void;
  onResolve?: () => void;
}) {
  const content = resultContent(result);
  const positive = result.kind === 'confirmed' || result.kind === 'sync_warning';
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4">
      <section className="w-full max-w-md rounded-xl border border-[#343941] bg-[#15181C] p-6 text-center shadow-2xl">
        <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${positive ? 'bg-emerald-500' : 'bg-red-500'}`}>
          <span className="material-symbols-outlined text-4xl text-white">{positive ? 'check' : 'close'}</span>
        </div>
        <h2 className={`mt-5 text-2xl font-bold ${positive ? 'text-emerald-300' : 'text-red-300'}`}>
          {content.title}
        </h2>
        <p className="mt-2 text-sm text-slate-300">{content.detail}</p>
        {(result.kind === 'confirmed' || result.kind === 'sync_warning') && (
          <AuthorityStatus
            state="historical"
            message={
              result.kind === 'sync_warning'
                ? 'The mark_used transaction is confirmed on Stellar; only the app mirror still needs synchronization.'
                : 'A recorded mark_used transaction confirms this ticket was consumed by the organizer.'
            }
            className="mt-5 text-left"
          />
        )}
        {(result.kind === 'status_unavailable' || result.kind === 'status_unknown') && (
          <AuthorityStatus
            state="unavailable"
            message={
              result.kind === 'status_unknown'
                ? 'A signed check-in may exist. Resolve it before scanning or admitting again.'
                : 'Current ticket ownership or status could not be verified. Do not admit.'
            }
            className="mt-5 text-left"
          />
        )}
        {result.ticketId && (
          <p className="mt-4 break-all font-mono text-xs text-slate-500">{result.ticketId}</p>
        )}
        {result.operation?.transaction_hash && (
          <p className="mt-2 truncate font-mono text-xs text-slate-500">{result.operation.transaction_hash}</p>
        )}
        {onResolve && ['status_unknown', 'sync_warning'].includes(result.kind) && (
          <button type="button" onClick={onResolve} disabled={busy} className="mt-6 w-full rounded-lg border border-amber-400/40 px-4 py-3 text-amber-100 disabled:opacity-40">
            {busy ? 'Resolving...' : 'Resolve operation'}
          </button>
        )}
        <button type="button" onClick={onNext} disabled={busy || result.kind === 'status_unknown'} className="mt-3 w-full rounded-lg bg-[#7C5CFF] px-4 py-3 font-semibold disabled:opacity-40">
          {positive ? 'Scan next ticket' : 'Try another scan'}
        </button>
      </section>
    </div>
  );
}

function resultContent(result: ScanResult): { title: string; detail: string } {
  switch (result.kind) {
    case 'confirmed':
      return { title: 'Entry confirmed', detail: 'Stellar confirmed the check-in.' };
    case 'sync_warning':
      return { title: 'Entry confirmed', detail: 'Stellar confirmed entry; app synchronization is delayed.' };
    case 'expired':
      return { title: 'QR expired', detail: 'Ask the attendee to refresh their QR.' };
    case 'invalid_qr':
      return { title: 'QR could not be verified', detail: 'The payload or signature is invalid.' };
    case 'not_found':
      return { title: 'Ticket not found', detail: 'No authoritative ticket exists for this ID.' };
    case 'wrong_event':
      return { title: 'Ticket belongs to another event', detail: 'Do not admit this attendee for this event.' };
    case 'transferred':
      return { title: 'Ticket has been transferred', detail: 'The current owner must show their own QR.' };
    case 'refunded':
      return { title: 'Ticket was refunded', detail: 'Refunded tickets are not eligible for entry.' };
    case 'already_used':
      return { title: 'Ticket already checked in', detail: 'This ticket has already been consumed on-chain.' };
    case 'wrong_wallet':
      return { title: 'Switch organizer wallet', detail: result.detail ?? 'Connect the event organizer wallet.' };
    case 'status_unavailable':
      return { title: 'Ticket status unavailable', detail: result.detail ?? 'Retry the authoritative read before admitting.' };
    case 'status_unknown':
      return { title: 'Check-in status unknown', detail: result.detail ?? 'A signed transaction may exist. Resolve it before rescanning this ticket.' };
    case 'chain_failed':
      return { title: 'Check-in failed', detail: result.detail ?? 'Re-read the ticket and use a fresh QR if still eligible.' };
  }
}
