import {
  isTicketOperationSyncRecovery,
  type TicketOperation,
} from '../../lib/ticketOperations';

const LABELS: Record<TicketOperation['operation_type'], string> = {
  refund: 'Refund',
  create_listing: 'Create listing',
  cancel_listing: 'Cancel listing',
  buy_listing: 'Marketplace purchase',
};

export function TicketOperationRecovery({
  operations,
  busyOperationId,
  error,
  onRecover,
}: {
  operations: TicketOperation[];
  busyOperationId: string | null;
  error: string | null;
  onRecover: (operation: TicketOperation) => void;
}) {
  if (operations.length === 0 && !error) return null;

  return (
    <section className="mb-8 rounded-xl border border-amber-400/30 bg-amber-400/10 p-4 text-amber-100">
      <h2 className="font-semibold">Some blockchain actions need attention</h2>
      <p className="mt-1 text-sm text-amber-200/80">
        These actions are already signed or confirmed. Resolve or synchronize them; do not submit
        the blockchain action again.
      </p>
      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}
      <div className="mt-4 space-y-3">
        {operations.map((operation) => (
          <div
            key={operation.operation_id}
            className="flex flex-col gap-3 rounded-lg border border-amber-300/20 bg-black/10 p-3 sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="text-sm font-semibold">{LABELS[operation.operation_type]}</p>
              <p className="mt-1 break-all font-mono text-xs text-amber-200/70">
                {operation.ticket_id}
              </p>
              {operation.failure_detail && (
                <p className="mt-1 text-xs text-amber-100/80">{operation.failure_detail}</p>
              )}
            </div>
            <button
              type="button"
              onClick={() => onRecover(operation)}
              disabled={busyOperationId !== null}
              className="rounded-lg border border-amber-300/40 px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {busyOperationId === operation.operation_id
                ? 'Working…'
                : isTicketOperationSyncRecovery(operation)
                  ? 'Retry synchronization'
                  : 'Resolve status'}
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
