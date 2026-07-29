import { useEffect, useRef } from 'react';
import { useBlocker } from 'react-router-dom';

interface OrganizerUnsavedWorkGuardOptions {
  shouldBlock: boolean;
  onDiscard?: () => void;
}

export function useOrganizerUnsavedWorkGuard({
  shouldBlock,
  onDiscard,
}: OrganizerUnsavedWorkGuardOptions) {
  const discardRef = useRef(onDiscard);
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    discardRef.current = onDiscard;
  }, [onDiscard]);

  useEffect(() => {
    if (!shouldBlock && blocker.state === 'blocked') blocker.reset();
  }, [blocker, shouldBlock]);

  useEffect(() => {
    if (!shouldBlock) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [shouldBlock]);

  const discardAndLeave = () => {
    discardRef.current?.();
    blocker.proceed?.();
  };

  return blocker.state === 'blocked' ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unsaved-work-title"
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 p-4"
    >
      <section className="w-full max-w-md rounded-2xl border border-[#343941] bg-[#15181C] p-6 shadow-2xl">
        <h2 id="unsaved-work-title" className="text-2xl font-bold">Leave without saving?</h2>
        <p className="mt-3 text-sm text-slate-300">
          Your organizer edits have not been safely saved.
        </p>
        <div className="mt-6 grid gap-3">
          <button
            type="button"
            onClick={() => blocker.reset?.()}
            className="rounded-lg border border-[#343941] px-4 py-3 font-semibold"
          >
            Stay
          </button>
          <button
            type="button"
            onClick={discardAndLeave}
            className="rounded-lg bg-red-500/90 px-4 py-3 font-semibold text-white"
          >
            Discard and leave
          </button>
        </div>
      </section>
    </div>
  ) : null;
}
