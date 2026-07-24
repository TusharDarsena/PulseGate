import { formatInTimeZone } from 'date-fns-tz';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthProvider';
import { REFUND_POLICY, RESALE_POLICY, zonedDateTimeToUnix } from '../../lib/eventModel';
import { createEvent } from '../../lib/soroban';
import {
  createEventPublicationDraft,
  fetchOpenEventPublicationDraft,
  invokeEventPublication,
  updatePreparedEventPublicationDraft,
  type EventPublicationDraft,
} from '../../lib/supabase';
import { generateID } from '../../lib/utils';
import { useAppStore } from '../../store/useAppStore';
import { xlmToStroops } from '../../types';

interface CreateEventPageProps {
  readonly onSubmit: (published: boolean) => void;
}

interface CreateEventFormData {
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
  capacity: string;
  priceXlm: string;
}

const DEFAULT_TIMEZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const EMPTY_FORM: CreateEventFormData = {
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

function timezones(): string[] {
  const supportedValuesOf = (
    Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] }
  ).supportedValuesOf;
  const values = supportedValuesOf ? supportedValuesOf('timeZone') : FALLBACK_TIMEZONES;
  return [...new Set([DEFAULT_TIMEZONE, ...values])].sort();
}

function formFromDraft(draft: EventPublicationDraft): CreateEventFormData {
  const start = new Date(draft.expected_date_unix * 1000);
  const end = new Date(draft.end_unix * 1000);
  return {
    name: draft.expected_name,
    summary: draft.summary,
    description: draft.description,
    imageUrl: draft.image_url,
    category: draft.category,
    startDate: formatInTimeZone(start, draft.timezone, 'yyyy-MM-dd'),
    startTime: formatInTimeZone(start, draft.timezone, 'HH:mm'),
    endDate: formatInTimeZone(end, draft.timezone, 'yyyy-MM-dd'),
    endTime: formatInTimeZone(end, draft.timezone, 'HH:mm'),
    timezone: draft.timezone,
    venue: draft.venue,
    address: draft.address,
    city: draft.city,
    organizerDisplayName: draft.organizer_display_name,
    supportContact: draft.support_contact,
    entryInstructions: draft.entry_instructions,
    capacity: String(draft.expected_capacity),
    priceXlm: (draft.expected_price_per_ticket / 10_000_000).toString(),
  };
}

export function CreateEventPage({ onSubmit }: CreateEventPageProps) {
  const { user } = useAuth();
  const { organizerWallet: wallet, setTxState } = useAppStore();
  const [form, setForm] = useState<CreateEventFormData>(EMPTY_FORM);
  const [draft, setDraft] = useState<EventPublicationDraft | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const zoneOptions = useMemo(timezones, []);

  const refreshDraft = async () => {
    const next = await fetchOpenEventPublicationDraft();
    setDraft(next);
    if (next?.state === 'prepared') setForm(formFromDraft(next));
    return next;
  };

  useEffect(() => {
    void refreshDraft()
      .catch((error) => setPageError(error instanceof Error ? error.message : 'Could not load draft.'))
      .finally(() => setLoadingDraft(false));
  }, []);

  const change = (field: keyof CreateEventFormData) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((current) => ({ ...current, [field]: event.target.value }));

  const retryPublication = async () => {
    if (!draft) return;
    setPageError(null);
    setTxState({ status: 'submitting', message: 'Verifying the existing on-chain event…' });
    try {
      const action = draft.state === 'creation_submitting'
        ? 'recover-submission'
        : 'retry-publication';
      const result = await invokeEventPublication(action, draft.draft_id);
      if (result.state === 'prepared') {
        await refreshDraft();
        setTxState({ status: 'idle' });
        setPageError('No on-chain event was found. Review the reserved draft before submitting.');
        return;
      }
      setTxState({
        status: 'success',
        hash: result.transactionHash,
        message: 'The existing event was verified and published.',
      });
      setTimeout(() => {
        setTxState({ status: 'idle' });
        onSubmit(true);
      }, 1500);
    } catch (error) {
      setTxState({ status: 'idle' });
      setPageError(error instanceof Error ? error.message : 'Publication retry failed.');
      await refreshDraft().catch(() => undefined);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) {
      setPageError('Sign in before creating an event.');
      return;
    }
    if (!wallet.isConnected || !wallet.publicKey || !wallet.signFn) {
      setPageError('Connect the organizer Freighter wallet before creating an event.');
      return;
    }
    if (draft && draft.intended_organizer_address !== wallet.publicKey) {
      setPageError('Reconnect the organizer wallet recorded on this reserved draft.');
      return;
    }

    setPageError(null);
    setTxState({ status: 'building', message: 'Reserving the complete private event draft…' });
    let activeDraft = draft;
    let creationBegan = false;
    try {
      const dateUnix = zonedDateTimeToUnix(form.startDate, form.startTime, form.timezone);
      const endUnix = zonedDateTimeToUnix(form.endDate, form.endTime, form.timezone);
      if (endUnix <= dateUnix) throw new Error('Event end must be after its start.');
      if (dateUnix <= Math.floor(Date.now() / 1000)) {
        throw new Error('Event start must be in the future.');
      }

      const capacity = Number.parseInt(form.capacity, 10);
      const price = Number.parseFloat(form.priceXlm);
      if (!Number.isSafeInteger(capacity) || capacity <= 0) {
        throw new Error('Capacity must be a positive whole number.');
      }
      if (!Number.isFinite(price) || price <= 0 || price > 900_000_000) {
        throw new Error('Enter a positive ticket price within the supported testnet range.');
      }
      const priceStroops = xlmToStroops(price);

      const draftValues = {
          name: form.name.trim(),
          dateUnix,
          endUnix,
          timezone: form.timezone,
          capacity,
          pricePerTicket: Number(priceStroops),
          summary: form.summary.trim(),
          description: form.description.trim(),
          imageUrl: form.imageUrl.trim(),
          category: form.category,
          venue: form.venue.trim(),
          address: form.address.trim(),
          city: form.city.trim(),
          organizerDisplayName: form.organizerDisplayName.trim(),
          supportContact: form.supportContact.trim(),
          entryInstructions: form.entryInstructions.trim(),
      };

      if (!activeDraft) {
        activeDraft = await createEventPublicationDraft({
          userId: user.id,
          eventId: generateID(),
          organizerAddress: wallet.publicKey,
          ...draftValues,
        });
        setDraft(activeDraft);
      } else {
        activeDraft = await updatePreparedEventPublicationDraft(
          activeDraft.draft_id,
          draftValues,
        );
        setDraft(activeDraft);
      }

      await invokeEventPublication('begin-creation', activeDraft.draft_id);
      creationBegan = true;
      setTxState({ status: 'signing', message: 'Approve event creation in Freighter…' });
      const transactionHash = await createEvent(
        {
          eventId: activeDraft.event_id,
          name: activeDraft.expected_name,
          dateUnix: activeDraft.expected_date_unix,
          capacityXlm: activeDraft.expected_capacity,
          priceStroops: BigInt(activeDraft.expected_price_per_ticket),
        },
        wallet.publicKey,
        wallet.signFn,
      );

      setTxState({ status: 'submitting', hash: transactionHash, message: 'Publishing verified event data…' });
      const result = await invokeEventPublication(
        'publish',
        activeDraft.draft_id,
        transactionHash,
      );
      setTxState({
        status: 'success',
        hash: transactionHash,
        message: 'Event created on-chain and published.',
      });
      setTimeout(() => {
        setTxState({ status: 'idle' });
        onSubmit(result.state === 'published');
      }, 1500);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Event creation failed.';
      setTxState({ status: 'idle' });
      setPageError(message);
      if (activeDraft && creationBegan) {
        await invokeEventPublication('recover-submission', activeDraft.draft_id)
          .then((result) => {
            if (result.state === 'published') {
              setPageError(null);
              onSubmit(true);
            }
          })
          .catch(() => undefined);
        await refreshDraft().catch(() => undefined);
      }
    }
  };

  if (loadingDraft) {
    return <main className="min-h-screen pt-28 text-center text-slate-400">Loading publication state…</main>;
  }

  const needsRecovery =
    draft?.state === 'creation_submitting' ||
    draft?.state === 'chain_created' ||
    draft?.state === 'publication_failed';

  return (
    <main className="min-h-screen pt-24 pb-28 px-4 max-w-5xl mx-auto">
      <div className="mb-8">
        <p className="text-sm font-semibold text-[#7C5CFF]">Organizer</p>
        <h1 className="mt-2 text-4xl font-bold">Create event</h1>
        <p className="mt-3 text-[#c9c4d8] max-w-2xl">
          Complete public information is reserved privately before the organizer signs the
          on-chain event. Only verified events enter public discovery.
        </p>
      </div>

      {pageError && (
        <div className="mb-6 rounded-xl border border-red-400/30 bg-red-400/10 p-4 text-red-100">
          {pageError}
        </div>
      )}

      {needsRecovery && draft ? (
        <section className="rounded-xl border border-amber-400/30 bg-[#15181C] p-6">
          <p className="text-xs uppercase tracking-widest text-amber-300">Publication interrupted</p>
          <h2 className="mt-2 text-2xl font-semibold">{draft.expected_name}</h2>
          <p className="mt-3 text-[#c9c4d8]">
            Event ID: <span className="font-mono">{draft.event_id}</span>
          </p>
          <p className="mt-2 text-[#c9c4d8]">
            State: {draft.state.replaceAll('_', ' ')}
          </p>
          {draft.last_error && (
            <div className="mt-4 rounded-lg bg-black/20 p-4 text-sm text-amber-100">
              {draft.last_error}
            </div>
          )}
          <button
            type="button"
            onClick={() => void retryPublication()}
            className="mt-6 rounded-lg bg-[#7C5CFF] px-5 py-3 font-semibold"
          >
            {draft.state === 'creation_submitting' ? 'Recover interrupted submission' : 'Retry publication'}
          </button>
          <p className="mt-3 text-xs text-[#938ea1]">
            This verifies and publishes the reserved event ID. It never submits create_event again.
          </p>
        </section>
      ) : (
        <form onSubmit={submit} className="space-y-8">
          <Section title="Public event information">
            <Field label="Event name"><input required value={form.name} onChange={change('name')} /></Field>
            <Field label="Short summary"><textarea required rows={2} value={form.summary} onChange={change('summary')} /></Field>
            <Field label="Full description"><textarea required rows={5} value={form.description} onChange={change('description')} /></Field>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Image URL"><input required type="url" value={form.imageUrl} onChange={change('imageUrl')} /></Field>
              <Field label="Category">
                <select required value={form.category} onChange={change('category')}>
                  <option value="">Select category</option>
                  {CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                </select>
              </Field>
            </div>
          </Section>

          <Section title="Date and timezone">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Start date"><input required type="date" value={form.startDate} onChange={change('startDate')} /></Field>
              <Field label="Start time"><input required type="time" value={form.startTime} onChange={change('startTime')} /></Field>
              <Field label="End date"><input required type="date" value={form.endDate} onChange={change('endDate')} /></Field>
              <Field label="End time"><input required type="time" value={form.endTime} onChange={change('endTime')} /></Field>
            </div>
            <Field label="IANA timezone">
              <select required value={form.timezone} onChange={change('timezone')}>
                {zoneOptions.map((zone) => <option key={zone}>{zone}</option>)}
              </select>
            </Field>
          </Section>

          <Section title="Venue and organizer">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Venue name"><input required value={form.venue} onChange={change('venue')} /></Field>
              <Field label="City"><input required value={form.city} onChange={change('city')} /></Field>
            </div>
            <Field label="Full address"><input required value={form.address} onChange={change('address')} /></Field>
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Organizer display name"><input required value={form.organizerDisplayName} onChange={change('organizerDisplayName')} /></Field>
              <Field label="Support contact"><input required value={form.supportContact} onChange={change('supportContact')} /></Field>
            </div>
            <Field label="Entry instructions"><textarea required rows={3} value={form.entryInstructions} onChange={change('entryInstructions')} /></Field>
          </Section>

          <Section title="On-chain sale values">
            <div className="grid md:grid-cols-2 gap-4">
              <Field label="Capacity"><input required type="number" min="1" step="1" value={form.capacity} onChange={change('capacity')} /></Field>
              <Field label="Price in XLM"><input required type="number" min="0.0000001" step="0.0000001" value={form.priceXlm} onChange={change('priceXlm')} /></Field>
            </div>
          </Section>

          <Section title="Platform policies">
            <p className="text-sm text-[#c9c4d8]"><strong>Refunds:</strong> {REFUND_POLICY.cancelled_event_original_price}</p>
            <p className="text-sm text-[#c9c4d8]"><strong>Resale:</strong> {RESALE_POLICY.stellar_marketplace_unlocked}</p>
          </Section>

          <button
            type="submit"
            className="w-full rounded-xl bg-[#7C5CFF] py-4 text-lg font-semibold hover:brightness-110"
          >
            Reserve draft and create on Stellar
          </button>
        </form>
      )}
    </main>
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

function Field({ label, children }: { label: string; children: React.ReactElement }) {
  return (
    <label className="block">
      <span className="mb-2 block text-xs font-semibold uppercase tracking-widest text-[#c9c4d8]">
        {label}
      </span>
      <div className="[&>input]:w-full [&>input]:rounded-lg [&>input]:border [&>input]:border-[#272C33] [&>input]:bg-[#0E1113] [&>input]:p-3 [&>textarea]:w-full [&>textarea]:rounded-lg [&>textarea]:border [&>textarea]:border-[#272C33] [&>textarea]:bg-[#0E1113] [&>textarea]:p-3 [&>select]:w-full [&>select]:rounded-lg [&>select]:border [&>select]:border-[#272C33] [&>select]:bg-[#0E1113] [&>select]:p-3">
        {children}
      </div>
    </label>
  );
}
