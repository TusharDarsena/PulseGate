import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useEvent } from '../../hooks/useEvent';
import { useWallet } from '../../hooks/useWallet';
import { useOrganizerUnsavedWorkGuard } from '../../hooks/useOrganizerUnsavedWorkGuard';
import {
  deriveOrganizerLifecycle,
  formatEventRange,
  ORGANIZER_LIFECYCLE_LABELS,
} from '../../lib/eventModel';
import { prepareCancelEvent, prepareReleaseFunds } from '../../lib/soroban';
import {
  getMyOrganizerEvent,
  invokeOrganizerEventOperation,
  updateOrganizerEventMetadata,
  type EventMetadataPatch,
  type OrganizerEventOperation,
  type OwnedOrganizerEvent,
} from '../../lib/supabase';
import { useAppStore } from '../../store/useAppStore';
import { xlmToStroops } from '../../types';

export function OrganizerEventPage() {
  const { eventId = '' } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const wallet = useAppStore((state) => state.organizerWallet);
  const { connectOrganizer } = useWallet();
  const chainState = useEvent(eventId);
  const [owned, setOwned] = useState<OwnedOrganizerEvent | null>(null);
  const [ownershipLoading, setOwnershipLoading] = useState(true);
  const [ownershipError, setOwnershipError] = useState<string | null>(null);
  const [operations, setOperations] = useState<OrganizerEventOperation[]>([]);
  const [metadata, setMetadata] = useState({
    summary: '',
    description: '',
    supportContact: '',
    entryInstructions: '',
    accessibilityNotes: '',
    ageRestriction: '',
    prohibitedItems: '',
    mapUrl: '',
    venue: '',
    address: '',
    city: '',
  });
  const [metadataState, setMetadataState] = useState<'saved' | 'unsaved' | 'saving' | 'failed'>('saved');
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [terminalReview, setTerminalReview] = useState<'cancel_event' | 'complete_event' | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [terminalFeeStroops, setTerminalFeeStroops] = useState<string | null>(null);
  const localMetadataEditRevision = useRef(0);
  const navigationPrompt = useOrganizerUnsavedWorkGuard({
    shouldBlock: metadataState !== 'saved' && metadataState !== 'saving',
    onDiscard: () => {
      setMetadataState('saved');
      setMetadataError(null);
    },
  });

  const reloadOwnership = async () => {
    const next = await getMyOrganizerEvent(eventId);
    setOwned(next);
    if (next) {
      setMetadata({
        summary: next.summary ?? '',
        description: next.description ?? '',
        supportContact: next.support_contact ?? '',
        entryInstructions: next.entry_instructions ?? '',
        accessibilityNotes: next.accessibility_notes ?? '',
        ageRestriction: next.age_restriction ?? '',
        prohibitedItems: next.prohibited_items ?? '',
        mapUrl: next.map_url ?? '',
        venue: next.venue ?? '',
        address: next.address ?? '',
        city: next.city ?? '',
      });
    }
    return next;
  };

  useEffect(() => {
    let active = true;
    const timeout = setTimeout(() => {
      setOwnershipLoading(true);
      setOwned(null);
      setOwnershipError(null);
      void getMyOrganizerEvent(eventId)
        .then((next) => {
          if (!active) return;
          setOwned(next);
          if (next) {
            setMetadata({
              summary: next.summary ?? '',
              description: next.description ?? '',
              supportContact: next.support_contact ?? '',
              entryInstructions: next.entry_instructions ?? '',
              accessibilityNotes: next.accessibility_notes ?? '',
              ageRestriction: next.age_restriction ?? '',
              prohibitedItems: next.prohibited_items ?? '',
              mapUrl: next.map_url ?? '',
              venue: next.venue ?? '',
              address: next.address ?? '',
              city: next.city ?? '',
            });
          }
        })
        .catch((error) => {
          if (active) setOwnershipError(error instanceof Error ? error.message : 'Could not verify event ownership.');
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
    void invokeOrganizerEventOperation('list', { eventId })
      .then((result) => setOperations(result.operations ?? []))
      .catch(() => setOperations([]));
  }, [eventId, owned]);

  const receiptOperationId = searchParams.get('operation');
  useEffect(() => {
    if (!receiptOperationId || !owned) return;
    void invokeOrganizerEventOperation('get', { operationId: receiptOperationId })
      .then(async (result) => {
        let operation = result.operation;
        if (operation?.event_id !== eventId) return;
        if (
          operation &&
          ['signed_submission_pending', 'confirmation_pending', 'status_unknown'].includes(
            operation.state,
          )
        ) {
          operation = (
            await invokeOrganizerEventOperation('resolve', {
              operationId: operation.operation_id,
            })
          ).operation;
        } else if (operation?.state === 'sync_warning') {
          operation = (
            await invokeOrganizerEventOperation('retry-sync', {
              operationId: operation.operation_id,
            })
          ).operation;
        }
        if (!operation) return;
        setOperations((current) => [
          operation,
          ...current.filter((item) => item.operation_id !== operation.operation_id),
        ]);
      })
      .catch(() => undefined);
  }, [eventId, owned, receiptOperationId]);

  const event = chainState.event;
  const lifecycle = event ? deriveOrganizerLifecycle(event) : 'unavailable';
  const walletMismatch = Boolean(
    event && wallet.publicKey && event.organizer !== wallet.publicKey,
  );
  const grossXlm = event ? event.currentSupply * event.pricePerTicket / 10_000_000 : null;
  const escrowXlm = event?.escrowBalance === undefined
    ? null
    : event.escrowBalance / 10_000_000;
  const sellThrough = event && event.capacity > 0
    ? Math.round(event.currentSupply / event.capacity * 100)
    : 0;
  const confirmedActivity = useMemo(
    () => operations.filter((operation) =>
      ['chain_confirmed', 'mirror_syncing', 'sync_warning', 'complete'].includes(operation.state)),
    [operations],
  );
  const unresolvedOperation = operations.find((operation) =>
    !['pre_submission_failed', 'chain_failed', 'complete'].includes(operation.state),
  );

  const changeMetadata = (field: keyof typeof metadata) =>
    (changeEvent: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      localMetadataEditRevision.current += 1;
      setMetadata((current) => ({ ...current, [field]: changeEvent.target.value }));
      setMetadataState('unsaved');
      setMetadataError(null);
    };

  const saveMetadata = async () => {
    if (!owned) return;
    const saveEditRevision = localMetadataEditRevision.current;
    setMetadataState('saving');
    setMetadataError(null);
    try {
      const patch: EventMetadataPatch = {
        summary: metadata.summary.trim(),
        description: metadata.description.trim(),
        support_contact: metadata.supportContact.trim(),
        entry_instructions: metadata.entryInstructions.trim(),
        accessibility_notes: metadata.accessibilityNotes.trim(),
        age_restriction: metadata.ageRestriction.trim(),
        prohibited_items: metadata.prohibitedItems.trim(),
      };
      if (venueEditable) {
        patch.map_url = metadata.mapUrl.trim();
        patch.venue = metadata.venue.trim();
        patch.address = metadata.address.trim();
        patch.city = metadata.city.trim();
      }
      const next = await updateOrganizerEventMetadata(
        eventId,
        owned.metadata_revision ?? 0,
        patch,
      );
      setOwned(next);
      if (localMetadataEditRevision.current === saveEditRevision) {
        setMetadata({
          summary: next.summary ?? '',
          description: next.description ?? '',
          supportContact: next.support_contact ?? '',
          entryInstructions: next.entry_instructions ?? '',
          accessibilityNotes: next.accessibility_notes ?? '',
          ageRestriction: next.age_restriction ?? '',
          prohibitedItems: next.prohibited_items ?? '',
          mapUrl: next.map_url ?? '',
          venue: next.venue ?? '',
          address: next.address ?? '',
          city: next.city ?? '',
        });
        setMetadataState('saved');
      } else {
        setMetadataState('unsaved');
      }
    } catch (error) {
      setMetadataState('failed');
      setMetadataError(error instanceof Error ? error.message : 'Metadata save failed.');
    }
  };

  const rememberOperation = (operation: OrganizerEventOperation) => {
    setOperations((current) => [
      operation,
      ...current.filter((item) => item.operation_id !== operation.operation_id),
    ]);
  };

  const submitTerminalOperation = async () => {
    if (
      !terminalReview ||
      !event ||
      !wallet.publicKey ||
      !wallet.signFn ||
      wallet.publicKey !== event.organizer
    ) {
      return;
    }
    setTerminalBusy(true);
    setTerminalError(null);
    let operationId: string | null = null;
    let signedHashPersisted = false;
    let transactionPrepared = false;
    try {
      const allocated = await invokeOrganizerEventOperation('allocate', {
        idempotencyKey: crypto.randomUUID(),
        eventId,
        operationType: terminalReview,
        ...(terminalReview === 'cancel_event'
          ? { cancellationReason: cancellationReason.trim() }
          : {}),
      });
      if (!allocated.operation) throw new Error('The organizer operation was not allocated.');
      operationId = allocated.operation.operation_id;
      rememberOperation(allocated.operation);

      const transaction = terminalReview === 'cancel_event'
        ? await prepareCancelEvent(eventId, wallet.publicKey)
        : await prepareReleaseFunds(eventId, wallet.publicKey);
      setTerminalFeeStroops(transaction.estimatedFeeStroops.toString());
      if (
        wallet.xlmBalance === null ||
        xlmToStroops(Number(wallet.xlmBalance)) < transaction.estimatedFeeStroops
      ) {
        throw new Error('The organizer wallet does not have enough XLM for the network fee.');
      }
      transactionPrepared = true;
      const begun = await invokeOrganizerEventOperation('begin-attempt', {
        operationId,
        ...transaction.identity,
      });
      if (begun.operation) rememberOperation(begun.operation);

      await transaction.submit(wallet.signFn, async ({ signedTransactionHash }) => {
        const signed = await invokeOrganizerEventOperation('record-signed-attempt', {
          operationId,
          signedTransactionHash,
        });
        if (!signed.operation) {
          throw new Error('The signed organizer transaction was not persisted.');
        }
        signedHashPersisted = true;
        rememberOperation(signed.operation);
      });

      const resolved = await invokeOrganizerEventOperation('resolve', { operationId });
      if (resolved.operation) rememberOperation(resolved.operation);
      setTerminalReview(null);
      navigate(`/organizer/events/${eventId}?operation=${operationId}`, { replace: true });
      await Promise.all([chainState.reload(), reloadOwnership()]);
    } catch (nextError) {
      const detail = nextError instanceof Error
        ? nextError.message
        : 'Organizer operation failed.';
      if (operationId) {
        try {
          if (signedHashPersisted) {
            const unresolved = await invokeOrganizerEventOperation('resolve', { operationId });
            if (unresolved.operation) rememberOperation(unresolved.operation);
          } else {
            const category = transactionPrepared
              ? (/reject|declin|cancel/i.test(detail)
                  ? 'approval_rejected'
                  : 'signing_provider_failed')
              : 'preparation_failed';
            const failed = await invokeOrganizerEventOperation('pre-submission-failed', {
              operationId,
              category,
              detail,
            });
            if (failed.operation) rememberOperation(failed.operation);
          }
        } catch {
          // Keep the original failure visible. The durable operation remains
          // discoverable from the event route for a later recovery attempt.
        }
      }
      setTerminalError(detail);
    } finally {
      setTerminalBusy(false);
    }
  };

  if (ownershipLoading) {
    return <main className="min-h-screen pt-28 text-center text-slate-400">Verifying organizer access…</main>;
  }
  if (!owned) {
    return (
      <main className="min-h-screen pt-28 px-4 text-center">
        <h1 className="text-3xl font-bold">Event unavailable</h1>
        <p className="mt-3 text-slate-400">
          {ownershipError ?? 'This event does not exist or is not owned by your signed-in account.'}
        </p>
      </main>
    );
  }
  if (chainState.loading) return <main className="min-h-screen pt-28 text-center">Loading authoritative event state…</main>;
  if (!event) {
    return <main className="min-h-screen pt-28 text-center">{chainState.error ?? 'Published event unavailable.'}</main>;
  }

  const exactWalletConnected = wallet.isConnected && wallet.publicKey === event.organizer;
  const actionsHaveAuthority = event.authority === 'confirmed' && escrowXlm !== null;
  const venueEditable = event.authority === 'confirmed' && event.currentSupply === 0;
  const scannerAuthorityUnavailable =
    event.authority !== 'confirmed' ||
    event.organizer !== owned.organizer_address;

  return (
    <>
      <main className="min-h-screen pt-24 pb-28 px-4 max-w-6xl mx-auto">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-[#7C5CFF]/15 px-3 py-1 text-sm text-[#b6a8ff]">
            {ORGANIZER_LIFECYCLE_LABELS[lifecycle]}
          </span>
          <span className={`rounded-full px-3 py-1 text-xs ${event.authority === 'confirmed' ? 'bg-emerald-400/10 text-emerald-200' : 'bg-amber-400/10 text-amber-200'}`}>
            {event.authority === 'confirmed' ? 'Confirmed from Stellar' : 'Authoritative read unavailable'}
          </span>
        </div>
        <h1 className="mt-3 text-4xl font-bold">{event.name}</h1>
        <p className="mt-2 text-slate-400">{formatEventRange(event)} · {event.venue}</p>
      </header>

      {walletMismatch && (
        <section className="mb-8 rounded-xl border border-amber-400/30 bg-amber-400/10 p-5 text-amber-100">
          This event belongs to {shortKey(event.organizer)}. Switch to the correct organizer wallet to continue.
        </section>
      )}

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Tickets sold" value={event.authority === 'confirmed' ? String(event.currentSupply) : 'Unavailable'} />
        <Metric label="Sell-through" value={event.authority === 'confirmed' ? `${sellThrough}%` : 'Unavailable'} />
        <Metric label="Gross primary sales" value={grossXlm === null || event.authority !== 'confirmed' ? 'Unavailable' : `${grossXlm.toLocaleString()} XLM`} />
        <Metric label="Held in escrow" value={escrowXlm === null ? 'Unavailable' : `${escrowXlm.toLocaleString()} XLM`} />
      </section>

      <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-8">
          <Section title="Overview">
            <p className="text-slate-300">{owned.description}</p>
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Event ID" value={event.eventId} mono />
              <Detail label="Organizer wallet" value={event.organizer} mono />
              <Detail label="Capacity" value={String(event.capacity)} />
              <Detail label="General Admission" value={`${event.pricePerTicket / 10_000_000} XLM`} />
            </dl>
          </Section>

          <Section title="Public listing">
            <p className="text-slate-400">Supporting information remains editable. Contract terms shown above are locked after publication.</p>
            <div className="grid gap-4">
              <MetadataField label="Short summary" value={metadata.summary} onChange={changeMetadata('summary')} />
              <MetadataField label="Full description" multiline value={metadata.description} onChange={changeMetadata('description')} />
              <MetadataField label="Support contact" value={metadata.supportContact} onChange={changeMetadata('supportContact')} />
              <MetadataField label="Entry instructions" multiline value={metadata.entryInstructions} onChange={changeMetadata('entryInstructions')} />
              <MetadataField label="Accessibility notes" multiline value={metadata.accessibilityNotes} onChange={changeMetadata('accessibilityNotes')} />
              <MetadataField label="Age restriction" value={metadata.ageRestriction} onChange={changeMetadata('ageRestriction')} />
              <MetadataField label="Prohibited items or venue notes" multiline value={metadata.prohibitedItems} onChange={changeMetadata('prohibitedItems')} />
              <div className="rounded-xl border border-[#343941] p-4">
                <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Venue information · {venueEditable ? 'Editable before first sale' : 'Locked after first sale'}
                </p>
                <div className="grid gap-4">
                  <MetadataField disabled={!venueEditable} label="Venue" value={metadata.venue} onChange={changeMetadata('venue')} />
                  <MetadataField disabled={!venueEditable} label="Address" value={metadata.address} onChange={changeMetadata('address')} />
                  <MetadataField disabled={!venueEditable} label="City" value={metadata.city} onChange={changeMetadata('city')} />
                  <MetadataField disabled={!venueEditable} label="Map URL" value={metadata.mapUrl} onChange={changeMetadata('mapUrl')} />
                </div>
              </div>
            </div>
            {metadataError && <p className="text-sm text-red-300">{metadataError}</p>}
            <div className="flex items-center gap-3">
              <button type="button" onClick={() => void saveMetadata()} disabled={metadataState === 'saving' || metadataState === 'saved'} className="rounded-lg bg-[#7C5CFF] px-4 py-2 font-semibold disabled:opacity-40">
                {metadataState === 'saving' ? 'Saving…' : 'Save public information'}
              </button>
              <span className="text-xs text-slate-400">
                Revision {owned.metadata_revision ?? 0} · {metadataState}
              </span>
            </div>
            <Link to={`/events/${eventId}`} className="inline-block text-[#a895ff]">View public event →</Link>
          </Section>

          <Section title="Activity">
            <Activity
              label="Event published"
              time={owned.chain_verified_at}
              detail={owned.creation_tx_hash}
            />
            {owned.metadata_updated_at && (
              <Activity label="Public information updated" time={owned.metadata_updated_at} />
            )}
            {confirmedActivity.map((operation) => (
              <Activity
                key={operation.operation_id}
                label={operation.operation_type === 'cancel_event' ? 'Event cancelled' : 'Event completed'}
                time={operation.chain_confirmed_at ?? operation.updated_at}
                detail={operation.transaction_hash}
                highlighted={receiptOperationId === operation.operation_id}
              />
            ))}
          </Section>
        </div>

        <aside className="space-y-6">
          <Section title="Organizer tools">
            <button
              type="button"
              onClick={() => navigate(`/organizer/events/${eventId}/check-in`)}
              disabled={scannerAuthorityUnavailable}
              className="w-full rounded-lg bg-[#7C5CFF] px-4 py-3 font-semibold disabled:opacity-40"
            >
              Open scanner
            </button>
            {scannerAuthorityUnavailable && (
              <p className="mt-2 text-xs text-amber-200">
                Scanner opens after authoritative event ownership is confirmed from Stellar.
              </p>
            )}
            {!wallet.isConnected && (
              <button type="button" onClick={() => void connectOrganizer()} className="w-full rounded-lg border border-[#7C5CFF]/60 px-4 py-3">
                Connect organizer wallet
              </button>
            )}
          </Section>

          <Section title="Lifecycle actions">
            <p className="text-sm text-slate-400">
              Cancellation and completion are mutually exclusive and require authoritative state plus the exact organizer wallet.
            </p>
            {unresolvedOperation && (
              <Link
                to={`/organizer/events/${eventId}?operation=${unresolvedOperation.operation_id}`}
                className="block rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm text-amber-100"
              >
                {unresolvedOperation.operation_type.replace('_event', '')} operation: {unresolvedOperation.state.replaceAll('_', ' ')}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                setTerminalFeeStroops(null);
                setTerminalError(null);
                setTerminalReview('cancel_event');
              }}
              disabled={event.status !== 'Active' || !actionsHaveAuthority || Boolean(unresolvedOperation)}
              className="w-full rounded-lg border border-red-400/40 px-4 py-3 text-red-200 disabled:opacity-40"
            >
              Review cancellation
            </button>
            <button
              type="button"
              onClick={() => {
                setTerminalFeeStroops(null);
                setTerminalError(null);
                setTerminalReview('complete_event');
              }}
              disabled={lifecycle !== 'awaiting_completion' || !actionsHaveAuthority || Boolean(unresolvedOperation)}
              className="w-full rounded-lg border border-emerald-400/40 px-4 py-3 text-emerald-200 disabled:opacity-40"
            >
              Review completion
            </button>
            {!actionsHaveAuthority && (
              <p className="text-xs text-amber-200">Actions stay disabled until event and escrow reads are confirmed from Stellar.</p>
            )}
          </Section>
        </aside>
      </div>

      {terminalReview && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-4">
          <section className="w-full max-w-lg rounded-2xl border border-[#343941] bg-[#15181C] p-6">
            <h2 className="text-2xl font-bold">
              {terminalReview === 'cancel_event' ? 'Cancel event' : 'Complete event'}
            </h2>
            <p className="mt-3 text-slate-300">
              {terminalReview === 'cancel_event'
                ? 'Cancellation is irreversible. Primary and resale purchases close, active tickets retain refund eligibility, and completion becomes unavailable.'
                : `Completion is irreversible. The event becomes historical and ${escrowXlm ?? 0} XLM is released to ${shortKey(event.organizer)}.`}
            </p>
            {terminalReview === 'cancel_event' && (
              <label className="mt-5 block">
                <span className="text-sm font-semibold">Public cancellation reason</span>
                <textarea value={cancellationReason} onChange={(changeEvent) => setCancellationReason(changeEvent.target.value)} rows={4} className="mt-2 w-full rounded-lg border border-[#343941] bg-[#0E1113] p-3" />
              </label>
            )}
            {!exactWalletConnected && (
              <p className="mt-4 text-amber-200">
                Connect {shortKey(event.organizer)} before requesting wallet approval.
              </p>
            )}
            {terminalFeeStroops && (
              <p className="mt-4 text-sm text-slate-300">
                Latest simulated network fee:{' '}
                {Number(BigInt(terminalFeeStroops)) / 10_000_000} XLM
              </p>
            )}
            {terminalError && (
              <p className="mt-4 rounded-lg border border-red-400/30 bg-red-400/10 p-3 text-sm text-red-100">
                {terminalError}
              </p>
            )}
            <button
              type="button"
              onClick={() => void submitTerminalOperation()}
              disabled={
                terminalBusy ||
                !exactWalletConnected ||
                (terminalReview === 'cancel_event' && !cancellationReason.trim())
              }
              className="mt-6 w-full rounded-lg bg-[#7C5CFF] px-4 py-3 font-semibold disabled:opacity-40"
            >
              {terminalBusy ? 'Processing safely…' : 'Continue to wallet approval'}
            </button>
            <p className="mt-2 text-xs text-slate-400">
              The two terminal actions share one event lock, and the signed
              transaction hash must be stored before submission.
            </p>
            <button type="button" onClick={() => setTerminalReview(null)} disabled={terminalBusy} className="mt-4 w-full rounded-lg border border-[#343941] px-4 py-3 disabled:opacity-40">
              Close
            </button>
          </section>
        </div>
      )}
      </main>
      {navigationPrompt}
    </>
  );
}

function shortKey(key: string): string {
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#272C33] bg-[#15181C] p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-[#272C33] bg-[#15181C] p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className={`mt-1 break-all ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  );
}

function MetadataField({
  label,
  value,
  onChange,
  multiline = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: React.ChangeEventHandler<HTMLInputElement | HTMLTextAreaElement>;
  multiline?: boolean;
  disabled?: boolean;
}) {
  return (
    <label>
      <span className="mb-2 block text-xs font-semibold uppercase tracking-wider text-slate-400">{label}</span>
      {multiline ? (
        <textarea disabled={disabled} rows={3} value={value} onChange={onChange} className="w-full rounded-lg border border-[#343941] bg-[#0E1113] p-3 disabled:opacity-50" />
      ) : (
        <input disabled={disabled} value={value} onChange={onChange} className="w-full rounded-lg border border-[#343941] bg-[#0E1113] p-3 disabled:opacity-50" />
      )}
    </label>
  );
}

function Activity({
  label,
  time,
  detail,
  highlighted = false,
}: {
  label: string;
  time?: string | null;
  detail?: string | null;
  highlighted?: boolean;
}) {
  return (
    <div className={`rounded-lg border p-4 ${highlighted ? 'border-[#7C5CFF] bg-[#7C5CFF]/10' : 'border-[#272C33]'}`}>
      <p className="font-semibold">{label}</p>
      <p className="mt-1 text-xs text-slate-400">{time ? new Date(time).toLocaleString() : 'Confirmed'}</p>
      {detail && <p className="mt-2 truncate font-mono text-xs text-slate-500">{detail}</p>}
    </div>
  );
}
