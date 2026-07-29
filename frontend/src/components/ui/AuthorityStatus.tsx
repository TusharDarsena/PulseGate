import { cn } from '../../lib/utils';

export type AuthorityStatusState =
  | 'checking'
  | 'confirmed'
  | 'unavailable'
  | 'historical';

const DEFAULT_MESSAGES: Record<AuthorityStatusState, string> = {
  checking: 'Checking current state on Stellar…',
  confirmed: 'Current state confirmed on Stellar.',
  unavailable: 'Stellar verification is unavailable. The affected action is disabled.',
  historical: 'Confirmed by a recorded Stellar contract event or receipt.',
};

const PRESENTATION: Record<
  AuthorityStatusState,
  { icon: string; label: string; className: string }
> = {
  checking: {
    icon: 'progress_activity',
    label: 'Checking',
    className: 'border-sky-400/30 bg-sky-400/10 text-sky-100',
  },
  confirmed: {
    icon: 'verified',
    label: 'Current state',
    className: 'border-emerald-400/30 bg-emerald-400/10 text-emerald-100',
  },
  unavailable: {
    icon: 'gpp_maybe',
    label: 'Verification unavailable',
    className: 'border-amber-400/30 bg-amber-400/10 text-amber-100',
  },
  historical: {
    icon: 'receipt_long',
    label: 'Recorded confirmation',
    className: 'border-violet-400/30 bg-violet-400/10 text-violet-100',
  },
};

export function AuthorityStatus({
  state,
  message,
  className,
}: {
  state: AuthorityStatusState;
  message?: string;
  className?: string;
}) {
  const presentation = PRESENTATION[state];

  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border px-4 py-3 text-sm',
        presentation.className,
        className,
      )}
      role="status"
      aria-live={state === 'unavailable' ? 'assertive' : 'polite'}
      data-authority-state={state}
    >
      <span
        aria-hidden="true"
        className={cn(
          'material-symbols-outlined mt-0.5 text-[18px]',
          state === 'checking' && 'motion-safe:animate-spin',
        )}
      >
        {presentation.icon}
      </span>
      <div>
        <p className="font-semibold">{presentation.label}</p>
        <p className="mt-0.5 opacity-80">{message ?? DEFAULT_MESSAGES[state]}</p>
      </div>
    </div>
  );
}
