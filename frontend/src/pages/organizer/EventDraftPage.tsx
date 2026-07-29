import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { REFUND_POLICY, RESALE_POLICY, zonedDateTimeToUnix } from '../../lib/eventModel';
import { prepareCreateEvent } from '../../lib/soroban';
import {
  beginEventPublication,
  deleteEventDraft,
  DraftConflictError,
  getMyEventDraft,
  preflightEventPublication,
  recordPublicationPreSubmissionFailure,
  recordSignedEventPublication,
  resolveEventPublication,
  retryEventPublicationSync,
  saveEventDraft,
  type EventDraftPatch,
  type EventPublicationDraft,
} from '../../lib/supabase';
import { useAppStore } from '../../store/useAppStore';
import { xlmToStroops } from '../../types';
import { useWallet } from '../../hooks/useWallet';
import { useOrganizerUnsavedWorkGuard } from '../../hooks/useOrganizerUnsavedWorkGuard';

type SaveState = 'saved' | 'unsaved' | 'saving' | 'failed' | 'offline' | 'conflict';

interface DraftForm {
  name: string;
  summary: string;
  description: string;
  imageUrl: string;
  category: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timezone: string;
  venue: string;
  address: string;
  city: string;
  organizerDisplayName: string;
  supportContact: string;
  entryInstructions: string;
  accessibilityNotes: string;
  ageRestriction: string;
  prohibitedItems: string;
  mapUrl: string;
  publicLinks: string;
  capacity: string;
  priceXlm: string;
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const EMPTY_FORM: DraftForm = {
  name: '',
  summary: '',
  description: '',
  imageUrl: '',
  category: '',
  startDate: '',
  startTime: '',
  endDate: '',
  endTime: '',
  timezone: DEFAULT_TIMEZONE,
  venue: '',
  address: '',
  city: '',
  organizerDisplayName: '',
  supportContact: '',
  entryInstructions: '',
  accessibilityNotes: '',
  ageRestriction: '',
  prohibitedItems: '',
  mapUrl: '',
  publicLinks: '',
  capacity: '',
  priceXlm: '',
};

const CATEGORIES = ['Music', 'Sports', 'Theater', 'Comedy', 'Festivals', 'Tech'];
const FALLBACK_TIMEZONES = [
  'UTC',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Paris',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Australia/Sydney',
];

function timezoneOptions(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  ).supportedValuesOf;
  const values = supportedValuesOf ? supportedValuesOf('timeZone') : FALLBACK_TIMEZONES;
  return [...new Set([DEFAULT_TIMEZONE, ...values])].sort();
}

function text(value: string | null | undefined): string {
  return value ?? '';
}

function dateParts(unix: number | null, timezone: string | null) {
  if (!unix || !timezone) return { date: '', time: '' };
  const instant = new Date(unix * 1000);
  return {
    date: formatInTimeZone(instant, timezone, 'yyyy-MM-dd'),
    time: formatInTimeZone(instant, timezone, 'HH:mm'),
  };
}

function formFromDraft(draft: EventPublicationDraft): DraftForm {
  const start = dateParts(draft.expected_date_unix, draft.timezone);
  const end = dateParts(draft.end_unix, draft.timezone);
  return {
    name: text(draft.expected_name),
    summary: text(draft.summary),
    description: text(draft.description),
    imageUrl: text(draft.image_url),
    category: text(draft.category),
    startDate: start.date,
    startTime: start.time,
    endDate: end.date,
    endTime: end.time,
    timezone: draft.timezone ?? DEFAULT_TIMEZONE,
    venue: text(draft.venue),
    address: text(draft.address),
    city: text(draft.city),
    organizerDisplayName: text(draft.organizer_display_name),
    supportContact: text(draft.support_contact),
    entryInstructions: text(draft.entry_instructions),
    accessibilityNotes: text(draft.accessibility_notes),
    ageRestriction: text(draft.age_restriction),
    prohibitedItems: text(draft.prohibited_items),
    mapUrl: text(draft.map_url),
    publicLinks: (draft.public_links ?? []).join('\n'),
    capacity: draft.expected_capacity ? String(draft.expected_capacity) : '',
    priceXlm: draft.expected_price_per_ticket
      ? String(draft.expected_price_per_ticket / 10_000_000)
      : '',
  };
}

function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed || null;
}

function buildPatch(form: DraftForm): EventDraftPatch {
  const capacity = form.capacity ? Number.parseInt(form.capacity, 10) : null;
  const price = form.priceXlm ? Number.parseFloat(form.priceXlm) : null;
  const startUnix = form.startDate && form.startTime
    ? zonedDateTimeToUnix(form.startDate, form.startTime, form.timezone)
    : null;
  const endUnix = form.endDate && form.endTime
    ? zonedDateTimeToUnix(form.endDate, form.endTime, form.timezone)
    : null;

  if (capacity !== null && (!Number.isSafeInteger(capacity) || capacity <= 0)) {
    throw new Error('Capacity must be a positive whole number.');
  }
  if (price !== null && (!Number.isFinite(price) || price <= 0 || price > 900_000_000)) {
    throw new Error('Enter a positive ticket price within the supported testnet range.');
  }
  if (startUnix !== null && endUnix !== null && endUnix <= startUnix) {
    throw new Error('Event end must be after its start.');
  }

  return {
    expected_name: optional(form.name),
    expected_date_unix: startUnix,
    expected_capacity: capacity,
    expected_price_per_ticket: price === null ? null : Number(xlmToStroops(price)),
    summary: optional(form.summary),
    description: optional(form.description),
    image_url: optional(form.imageUrl),
    category: optional(form.category),
    timezone: form.timezone,
    end_unix: endUnix,
    venue: optional(form.venue),
    address: optional(form.address),
    city: optional(form.city),
    organizer_display_name: optional(form.organizerDisplayName),
    support_contact: optional(form.supportContact),
    entry_instructions: optional(form.entryInstructions),
    accessibility_notes: optional(form.accessibilityNotes),
    age_restriction: optional(form.ageRestriction),
    prohibited_items: optional(form.prohibitedItems),
    map_url: optional(form.mapUrl),
    public_links: form.publicLinks.split('\n').map((value) => value.trim()).filter(Boolean),
  };
}

function publicationIssues(form: DraftForm, organizerAddress: string | null): string[] {
  const required: Array<[string, string]> = [
    ['title', form.name],
    ['category', form.category],
    ['short summary', form.summary],
    ['full description', form.description],
    ['poster URL', form.imageUrl],
    ['organizer display name', form.organizerDisplayName],
    ['support contact', form.supportContact],
    ['start date and time', `${form.startDate}${form.startTime}`],
    ['end date and time', `${form.endDate}${form.endTime}`],
    ['timezone', form.timezone],
    ['venue', form.venue],
    ['full address', form.address],
    ['city', form.city],
    ['capacity', form.capacity],
    ['ticket price', form.priceXlm],
    ['entry instructions', form.entryInstructions],
  ];
  const missing = required.filter(([, value]) => !value.trim()).map(([label]) => label);
  if (!organizerAddress) missing.push('organizer wallet');
  if (form.startDate && form.startTime) {
    try {
      const startUnix = zonedDateTimeToUnix(form.startDate, form.startTime, form.timezone);
      if (startUnix <= Math.floor(Date.now() / 1000)) missing.push('a future start time');
    } catch {
      missing.push('a valid start time');
    }
  }
  if (form.startDate && form.startTime && form.endDate && form.endTime) {
    try {
      const startUnix = zonedDateTimeToUnix(form.startDate, form.startTime, form.timezone);
      const endUnix = zonedDateTimeToUnix(form.endDate, form.endTime, form.timezone);
      if (endUnix <= startUnix) missing.push('an end time after the start');
    } catch {
      missing.push('a valid end time');
    }
  }
  return missing;
}

export function EventDraftPage() {
  const { draftId = '' } = useParams();
  const navigate = useNavigate();
  const wallet = useAppStore((state) => state.organizerWallet);
  const { connectOrganizer } = useWallet();
  const [draft, setDraft] = useState<EventPublicationDraft | null>(null);
  const [form, setForm] = useState<DraftForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const [error, setError] = useState<string | null>(null);
  const [serverConflict, setServerConflict] = useState<EventPublicationDraft | null>(null);
  const [showReview, setShowReview] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [publicationFeeStroops, setPublicationFeeStroops] = useState<string | null>(null);
  const localEditRevision = useRef(0);
  const navigationPrompt = useOrganizerUnsavedWorkGuard({
    shouldBlock: saveState !== 'saved' && saveState !== 'saving',
    onDiscard: () => {
      setSaveState('saved');
      setError(null);
      setServerConflict(null);
    },
  });
  const zones = useMemo(() => timezoneOptions(), []);

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'The wallet action failed.');
    }
  };

  useEffect(() => {
    let active = true;
    void getMyEventDraft(draftId)
      .then((next) => {
        if (!active) return;
        setDraft(next);
        if (next) setForm(formFromDraft(next));
      })
      .catch((nextError) => {
        if (active) setError(nextError instanceof Error ? nextError.message : 'Could not load draft.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [draftId]);

  useEffect(() => {
    const online = () => setSaveState((state) => state === 'offline' ? 'unsaved' : state);
    const offline = () => setSaveState((state) => state === 'saved' ? state : 'offline');
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  const change = (field: keyof DraftForm) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
      localEditRevision.current += 1;
      setForm((current) => ({ ...current, [field]: event.target.value }));
      setSaveState(navigator.onLine ? 'unsaved' : 'offline');
      setError(null);
      setServerConflict(null);
    };

  const save = async () => {
    if (!draft || draft.state !== 'prepared') return;
    if (!navigator.onLine) {
      setSaveState('offline');
      setError('You are offline. Your edits remain in this page and have not been saved.');
      return;
    }
    const saveEditRevision = localEditRevision.current;
    setSaveState('saving');
    setError(null);
    try {
      const next = await saveEventDraft(
        draft.draft_id,
        draft.revision,
        buildPatch(form),
      );
      setDraft(next);
      if (localEditRevision.current === saveEditRevision) {
        setForm(formFromDraft(next));
        setSaveState('saved');
      } else {
        setSaveState('unsaved');
      }
    } catch (nextError) {
      if (nextError instanceof DraftConflictError) {
        setSaveState('conflict');
        setError(nextError.message);
        const latest = await getMyEventDraft(draft.draft_id).catch(() => null);
        setServerConflict(latest);
      } else {
        setSaveState(navigator.onLine ? 'failed' : 'offline');
        setError(nextError instanceof Error ? nextError.message : 'Draft save failed.');
      }
    }
  };

  const bindOrganizer = async () => {
    if (!draft || draft.state !== 'prepared' || draft.intended_organizer_address) return;
    setError(null);
    try {
      let activeWallet = wallet;
      if (!activeWallet.isConnected || !activeWallet.publicKey || !activeWallet.signFn) {
        activeWallet = await connectOrganizer();
      }
      if (!activeWallet.publicKey) {
        throw new Error('Connect Freighter before binding this draft to an organizer wallet.');
      }
      const bindEditRevision = localEditRevision.current;
      setSaveState('saving');
      const next = await saveEventDraft(draft.draft_id, draft.revision, {
        intended_organizer_address: activeWallet.publicKey,
      });
      setDraft(next);
      if (localEditRevision.current === bindEditRevision) {
        setForm(formFromDraft(next));
        setSaveState('saved');
      } else {
        setSaveState('unsaved');
      }
    } catch (nextError) {
      setSaveState(navigator.onLine ? 'failed' : 'offline');
      setError(nextError instanceof Error ? nextError.message : 'Could not bind the organizer wallet.');
    }
  };

  const remove = async () => {
    if (!draft || draft.state !== 'prepared') return;
    if (!window.confirm('Delete this unpublished draft? Its reserved event ID will not be reused.')) {
      return;
    }
    try {
      await deleteEventDraft(draft.draft_id);
      navigate('/organizer/events', { replace: true });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Could not delete draft.');
    }
  };

  const publishOrRecover = async () => {
    if (!draft) return;
    setPublicationBusy(true);
    setError(null);
    try {
      let activeWallet = wallet;
      if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) {
        activeWallet = await connectOrganizer();
      }
      if (!draft.intended_organizer_address) {
        throw new Error('Save this draft once after connecting Freighter to bind the organizer wallet.');
      }
      if (activeWallet.publicKey !== draft.intended_organizer_address) {
        throw new Error('Connect the exact organizer wallet reserved by this draft.');
      }
      if (draft.state === 'approval_required') {
        const reset = await recordPublicationPreSubmissionFailure(
          draft.draft_id,
          'approval_expired',
          'The previous unsigned approval attempt was interrupted before a signed hash was stored.',
        );
        setDraft(reset);
        return;
      }
      if (draft.state === 'chain_confirmed' || draft.state === 'sync_warning') {
        const next = await retryEventPublicationSync(draft.draft_id);
        setDraft(next);
        return;
      }
      if (
        ['signed_submission_pending', 'confirmation_pending', 'status_unknown'].includes(
          draft.state,
        )
      ) {
        const next = await resolveEventPublication(draft.draft_id);
        setDraft(next);
        return;
      }
      if (!['prepared', 'publication_failed'].includes(draft.state)) {
        throw new Error('This publication is not ready for a new transaction.');
      }
      if (saveState !== 'saved') {
        throw new Error('Save this draft successfully before publishing.');
      }

      const { draft: checkedDraft, preflight } = await preflightEventPublication(
        draft.draft_id,
      );
      if (
        checkedDraft.expected_name === null ||
        checkedDraft.expected_date_unix === null ||
        checkedDraft.end_unix === null ||
        checkedDraft.expected_capacity === null ||
        checkedDraft.expected_price_per_ticket === null
      ) {
        throw new Error('The publication preflight returned incomplete contract terms.');
      }
      if (
        preflight.organizerAddress !== activeWallet.publicKey ||
        checkedDraft.intended_organizer_address !== activeWallet.publicKey
      ) {
        throw new Error('Connect the exact organizer wallet reserved by this draft.');
      }

      const transaction = await prepareCreateEvent(
        {
          eventId: preflight.eventId,
          name: checkedDraft.expected_name,
          dateUnix: checkedDraft.expected_date_unix,
          endUnix: checkedDraft.end_unix,
          capacityXlm: checkedDraft.expected_capacity,
          priceStroops: BigInt(checkedDraft.expected_price_per_ticket),
        },
        activeWallet.publicKey,
      );
      setPublicationFeeStroops(transaction.estimatedFeeStroops.toString());
      if (
        activeWallet.xlmBalance === null ||
        xlmToStroops(Number(activeWallet.xlmBalance)) < transaction.estimatedFeeStroops
      ) {
        throw new Error('The organizer wallet does not have enough XLM for the network fee.');
      }
      const begun = await beginEventPublication(draft.draft_id, transaction.identity);
      setDraft(begun);

      let signedHashPersisted = false;
      try {
        await transaction.submit(activeWallet.signFn!, async ({ signedTransactionHash }) => {
          const signed = await recordSignedEventPublication(
            draft.draft_id,
            signedTransactionHash,
          );
          signedHashPersisted = true;
          setDraft(signed);
        });
      } catch (submissionError) {
        const detail = submissionError instanceof Error
          ? submissionError.message
          : 'Organizer transaction failed.';
        if (!signedHashPersisted) {
          const category = /reject|declin|cancel/i.test(detail)
            ? 'approval_rejected'
            : 'signing_provider_failed';
          const failed = await recordPublicationPreSubmissionFailure(
            draft.draft_id,
            category,
            detail,
          );
          setDraft(failed);
        } else {
          const unresolved = await resolveEventPublication(draft.draft_id);
          setDraft(unresolved);
        }
        throw submissionError;
      }

      const resolved = await resolveEventPublication(draft.draft_id);
      setDraft(resolved);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Publication failed.');
    } finally {
      setPublicationBusy(false);
    }
  };

  if (loading) return <main className="min-h-screen pt-28 text-center text-slate-400">Loading draft…</main>;
  if (!draft) {
    return (
      <main className="min-h-screen pt-28 px-4 text-center">
        <h1 className="text-3xl font-bold">Draft unavailable</h1>
        <p className="mt-3 text-slate-400">{error ?? 'This draft does not exist or belongs to another user.'}</p>
        <Link to="/organizer/events" className="mt-6 inline-block text-[#9f8cff]">Return to organizer hub</Link>
      </main>
    );
  }

  if (draft.state === 'published') {
    return (
      <main className="min-h-screen pt-28 pb-24 px-4 max-w-3xl mx-auto">
        <p className="text-sm font-semibold text-emerald-300">Published</p>
        <h1 className="mt-2 text-4xl font-bold">{draft.expected_name}</h1>
        <section className="mt-8 rounded-xl border border-[#272C33] bg-[#15181C] p-6">
          <h2 className="text-xl font-semibold">Publication receipt</h2>
          <dl className="mt-4 grid gap-3 text-sm">
            <div><dt className="text-slate-400">Event ID</dt><dd className="break-all font-mono">{draft.event_id}</dd></div>
            <div><dt className="text-slate-400">Transaction</dt><dd className="break-all font-mono">{draft.creation_tx_hash ?? 'Unavailable'}</dd></div>
            <div><dt className="text-slate-400">Verified</dt><dd>{draft.chain_verified_at ? new Date(draft.chain_verified_at).toLocaleString() : 'Verification recorded'}</dd></div>
          </dl>
          <Link
            to={`/organizer/events/${draft.event_id}`}
            className="mt-6 inline-block rounded-lg bg-[#7C5CFF] px-5 py-3 font-semibold text-white"
          >
            Manage event
          </Link>
        </section>
      </main>
    );
  }

  const editable = draft.state === 'prepared';
  const organizerAddress = draft.intended_organizer_address;
  const missing = publicationIssues(form, organizerAddress);
  const walletMismatch = Boolean(
    wallet.publicKey &&
    draft.intended_organizer_address &&
    wallet.publicKey !== draft.intended_organizer_address,
  );
  const exactWalletConnected = Boolean(
    wallet.isConnected &&
    wallet.signFn &&
    wallet.publicKey &&
    wallet.publicKey === draft.intended_organizer_address,
  );
  const requiredTotal = 17;
  const completedRequired = Math.max(0, requiredTotal - missing.length);
  const completionPercent = Math.min(100, Math.round((completedRequired / requiredTotal) * 100));
  const canStartPublication = ['prepared', 'publication_failed'].includes(draft.state);
  const canResolvePublication = [
    'approval_required',
    'signed_submission_pending',
    'confirmation_pending',
    'status_unknown',
    'chain_confirmed',
    'sync_warning',
  ].includes(draft.state);
  const publicationLabel = publicationBusy
    ? 'Checking publication…'
    : canResolvePublication
      ? 'Recover publication'
      : 'Publish on Stellar';

  return (
    <>
      <main className="min-h-screen pt-24 pb-28 px-4 max-w-5xl mx-auto">
      <header className="mb-8 flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <Link to="/organizer/events" className="text-sm font-semibold text-[#cabeff]">← Organizer Hub</Link>
        <div>
          <p className="text-sm font-semibold text-[#9f8cff]">Private event workspace</p>
          <h1 className="mt-2 text-4xl font-bold">{form.name || 'Untitled event'}</h1>
          <p className="mt-2 text-sm text-slate-400">
            Revision {draft.revision} · {SAVE_LABELS[saveState]}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          {editable && (
            <>
              <button type="button" onClick={() => void remove()} className="rounded-lg border border-red-400/30 px-4 py-2 text-red-300">
                Delete draft
              </button>
              <button type="button" onClick={() => void save()} disabled={saveState === 'saving'} className="rounded-lg bg-[#7C5CFF] px-5 py-2 font-semibold disabled:opacity-50">
                {saveState === 'saving' ? 'Saving…' : 'Save draft'}
              </button>
            </>
          )}
        </div>
      </header>

      <section className="mb-8 rounded-2xl border border-[#7C5CFF]/30 bg-[#191622] p-5 shadow-[0_12px_40px_rgba(124,92,255,0.08)]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#9f8cff]">Publication checklist</p>
            <h2 className="mt-1 text-xl font-semibold">
              {missing.length === 0 ? 'Ready for review' : `${completedRequired} of ${requiredTotal} requirements complete`}
            </h2>
          </div>
          <span className="rounded-full border border-[#343941] px-3 py-1 text-sm text-slate-300">
            {completionPercent}% complete
          </span>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#0E1113]" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={completionPercent}>
          <div className="h-full rounded-full bg-gradient-to-r from-[#7C5CFF] to-[#b39cff] transition-all" style={{ width: `${completionPercent}%` }} />
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-3 py-1 ${saveState === 'saved' ? 'bg-emerald-500/15 text-emerald-200' : 'bg-amber-500/15 text-amber-200'}`}>
            {saveState === 'saved' ? '✓ Draft saved' : '● Save your latest edits'}
          </span>
          <span className={`rounded-full px-3 py-1 ${exactWalletConnected ? 'bg-emerald-500/15 text-emerald-200' : 'bg-slate-500/15 text-slate-300'}`}>
            {exactWalletConnected ? '✓ Organizer wallet connected' : 'Connect organizer wallet to publish'}
          </span>
        </div>
        {missing.length > 0 && (
          <p className="mt-4 text-sm text-amber-200">
            Next up: {missing.slice(0, 3).join(', ')}{missing.length > 3 ? `, and ${missing.length - 3} more` : ''}.
          </p>
        )}
      </section>

      {error && (
        <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
          {error}
          {saveState === 'conflict' && serverConflict && (
            <button
              type="button"
              onClick={() => {
                setDraft(serverConflict);
                setForm(formFromDraft(serverConflict));
                setServerConflict(null);
                setSaveState('saved');
                setError(null);
              }}
              className="ml-3 underline"
            >
              Load revision {serverConflict.revision}
            </button>
          )}
        </div>
      )}

      {!editable && (
        <div className="mb-6 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4">
          Publication state: <strong>{draft.state.replaceAll('_', ' ')}</strong>. Contract terms are frozen while submission may have occurred.
        </div>
      )}

      {walletMismatch && (
        <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
          This draft belongs to {shortKey(draft.intended_organizer_address!)}. Switch to the correct organizer wallet before publishing.
          <button type="button" onClick={() => void run(connectOrganizer)} className="ml-3 underline">Switch wallet</button>
        </div>
      )}

      <div className="space-y-8">
        <Section title="Public event information">
          <Field required label="Event name"><input disabled={!editable} value={form.name} onChange={change('name')} /></Field>
          <Field required label="Short summary"><textarea disabled={!editable} rows={2} value={form.summary} onChange={change('summary')} /></Field>
          <Field required label="Full description"><textarea disabled={!editable} rows={5} value={form.description} onChange={change('description')} /></Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field required label="Poster URL"><input disabled={!editable} type="url" value={form.imageUrl} onChange={change('imageUrl')} /></Field>
            <Field required label="Category">
              <select disabled={!editable} value={form.category} onChange={change('category')}>
                <option value="">Select category</option>
                {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
              </select>
            </Field>
          </div>
        </Section>

        <Section title="Schedule">
          <div className="grid md:grid-cols-2 gap-4">
            <Field required label="Start date"><input disabled={!editable} type="date" value={form.startDate} onChange={change('startDate')} /></Field>
            <Field required label="Start time"><input disabled={!editable} type="time" value={form.startTime} onChange={change('startTime')} /></Field>
            <Field required label="End date"><input disabled={!editable} type="date" value={form.endDate} onChange={change('endDate')} /></Field>
            <Field required label="End time"><input disabled={!editable} type="time" value={form.endTime} onChange={change('endTime')} /></Field>
          </div>
          <Field required label="IANA timezone">
            <select disabled={!editable} value={form.timezone} onChange={change('timezone')}>
              {zones.map((zone) => <option key={zone}>{zone}</option>)}
            </select>
          </Field>
        </Section>

        <Section title="Venue and entry">
          <div className="grid md:grid-cols-2 gap-4">
            <Field required label="Venue"><input disabled={!editable} value={form.venue} onChange={change('venue')} /></Field>
            <Field required label="City"><input disabled={!editable} value={form.city} onChange={change('city')} /></Field>
          </div>
          <Field required label="Full address"><input disabled={!editable} value={form.address} onChange={change('address')} /></Field>
          <Field label="Map URL"><input disabled={!editable} type="url" value={form.mapUrl} onChange={change('mapUrl')} /></Field>
          <Field required label="Entry instructions"><textarea disabled={!editable} rows={3} value={form.entryInstructions} onChange={change('entryInstructions')} /></Field>
        </Section>

        <Section title="Organizer and attendee guidance">
          <div className="grid md:grid-cols-2 gap-4">
            <Field required label="Organizer display name"><input disabled={!editable} value={form.organizerDisplayName} onChange={change('organizerDisplayName')} /></Field>
            <Field required label="Support contact"><input disabled={!editable} value={form.supportContact} onChange={change('supportContact')} /></Field>
          </div>
          <Field label="Accessibility notes"><textarea disabled={!editable} rows={2} value={form.accessibilityNotes} onChange={change('accessibilityNotes')} /></Field>
          <Field label="Age restriction"><input disabled={!editable} value={form.ageRestriction} onChange={change('ageRestriction')} /></Field>
          <Field label="Prohibited items or venue notes"><textarea disabled={!editable} rows={2} value={form.prohibitedItems} onChange={change('prohibitedItems')} /></Field>
          <Field label="Public links (one per line)"><textarea disabled={!editable} rows={3} value={form.publicLinks} onChange={change('publicLinks')} /></Field>
        </Section>

        <Section title="General Admission contract terms">
          <div className="grid md:grid-cols-2 gap-4">
            <Field required label="Capacity"><input disabled={!editable} type="number" min="1" step="1" value={form.capacity} onChange={change('capacity')} /></Field>
            <Field required label="Price in XLM"><input disabled={!editable} type="number" min="0.0000001" step="0.0000001" value={form.priceXlm} onChange={change('priceXlm')} /></Field>
          </div>
          <p className="text-sm text-slate-400">These values, the title, schedule, event ID, and organizer wallet lock after publication.</p>
        </Section>

        <Section title="Platform policies">
          <p className="text-sm text-[#c9c4d8]"><strong>Refunds:</strong> {REFUND_POLICY.cancelled_event_original_price}</p>
          <p className="text-sm text-[#c9c4d8]"><strong>Resale:</strong> {RESALE_POLICY.stellar_marketplace_unlocked}</p>
        </Section>

        <section className="rounded-xl border border-[#7C5CFF]/40 bg-[#15181C] p-6">
          <h2 className="text-xl font-semibold">Review and publish</h2>
          {missing.length > 0 ? (
            <p className="mt-3 text-amber-200">Complete: {missing.join(', ')}.</p>
          ) : (
            <p className="mt-3 text-emerald-200">All publication fields are complete.</p>
          )}
          <button type="button" onClick={() => setShowReview((value) => !value)} className="mt-4 rounded-lg border border-[#7C5CFF]/50 px-4 py-2">
            {showReview ? 'Hide attendee preview' : 'Review attendee preview'}
          </button>
          {showReview && <DraftPreview form={form} />}
          {!exactWalletConnected && (
            <div className="mt-5 rounded-lg border border-amber-400/30 bg-amber-400/10 p-4 text-sm text-amber-100">
              {!wallet.isConnected ? (
                <>
                  <p>Connect the organizer wallet in Freighter to publish this event.</p>
                  <button
                    type="button"
                    onClick={() => void run(connectOrganizer)}
                    className="mt-3 rounded-lg bg-[#7C5CFF] px-4 py-2 font-semibold text-white"
                  >
                    Connect Freighter
                  </button>
                </>
              ) : walletMismatch ? (
                <><p>Switch Freighter to the wallet reserved by this draft before publishing.</p><button type="button" onClick={() => void run(connectOrganizer)} className="mt-3 rounded-lg border border-[#7C5CFF]/60 px-4 py-2 font-semibold text-white">Switch wallet</button></>
              ) : !draft.intended_organizer_address ? (
                <>
                  <p>Bind this unassigned draft to the connected organizer wallet before publishing.</p>
                  <button
                    type="button"
                    onClick={() => void bindOrganizer()}
                    disabled={saveState === 'saving'}
                    className="mt-3 rounded-lg bg-[#7C5CFF] px-4 py-2 font-semibold text-white disabled:opacity-50"
                  >
                    Bind organizer wallet
                  </button>
                </>
              ) : (
                <>
                  <p>Freighter signing is not ready yet. Reconnect Freighter and try again.</p>
                  <button
                    type="button"
                    onClick={() => void run(connectOrganizer)}
                    className="mt-3 rounded-lg border border-[#7C5CFF]/60 px-4 py-2 font-semibold text-white"
                  >
                    Reconnect Freighter
                  </button>
                </>
              )}
            </div>
          )}
          {publicationFeeStroops && (
            <p className="mt-4 text-sm text-slate-300">
              Latest simulated network fee:{' '}
              {Number(BigInt(publicationFeeStroops)) / 10_000_000} XLM
            </p>
          )}
          <button
            type="button"
            onClick={() => void publishOrRecover()}
            disabled={
              publicationBusy ||
              (!canResolvePublication && (
                !canStartPublication ||
                missing.length > 0 ||
                saveState !== 'saved'
              ))
            }
            className="mt-5 w-full rounded-xl bg-[#7C5CFF] py-4 text-lg font-semibold disabled:cursor-not-allowed disabled:opacity-40"
          >
            {publicationLabel}
          </button>
          <p className="mt-3 text-xs text-slate-400">
            The signed transaction hash is persisted before submission. If confirmation
            is interrupted, use recovery instead of creating another event.
          </p>
        </section>
      </div>
      </main>
      {navigationPrompt}
    </>
  );
}

const SAVE_LABELS: Record<SaveState, string> = {
  saved: 'Saved',
  unsaved: 'Unsaved changes',
  saving: 'Saving…',
  failed: 'Save failed',
  offline: 'Offline — not saved',
  conflict: 'Conflict — local edits preserved',
};

function shortKey(key: string): string {
  return `${key.slice(0, 5)}…${key.slice(-4)}`;
}

function DraftPreview({ form }: { form: DraftForm }) {
  return (
    <article className="mt-5 overflow-hidden rounded-xl border border-[#272C33] bg-[#0E1113]">
      {form.imageUrl && <img src={form.imageUrl} alt="" className="h-52 w-full object-cover" />}
      <div className="p-5">
        <p className="text-sm text-[#9f8cff]">{form.category || 'Category not set'}</p>
        <h3 className="mt-1 text-2xl font-bold">{form.name || 'Untitled event'}</h3>
        <p className="mt-2 text-slate-300">{form.summary || 'No summary yet.'}</p>
        <p className="mt-4 text-sm text-slate-400">{form.venue}, {form.city}</p>
      </div>
    </article>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[#272C33] bg-[#15181C] p-6 space-y-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, required = false, children }: { label: string; required?: boolean; children: React.ReactElement }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[#c9c4d8]">
        {label}{required && <span className="ml-1 text-[#b39cff]" aria-hidden="true">*</span>}
      </span>
      <div className="[&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-[#272C33] [&>input]:bg-[#0E1113] [&>input]:p-3 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-[#272C33] [&>textarea]:bg-[#0E1113] [&>textarea]:p-3 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-[#272C33] [&>select]:bg-[#0E1113] [&>select]:p-3 [&_input:disabled]:opacity-60 [&_textarea:disabled]:opacity-60 [&_select:disabled]:opacity-60">
        {children}
      </div>
    </label>
  );
}
