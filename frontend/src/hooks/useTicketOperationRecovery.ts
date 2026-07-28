import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import {
  isRecoverableTicketOperation,
  isTicketOperationSyncRecovery,
  listTicketOperations,
  resolveTicketOperation,
  retryTicketOperationSync,
  type TicketOperation,
} from '../lib/ticketOperations';

export function useTicketOperationRecovery() {
  const { user, loading: authLoading } = useAuth();
  const [operations, setOperations] = useState<TicketOperation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyOperationId, setBusyOperationId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const refresh = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (authLoading) return;
    if (!user) {
      setOperations([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    try {
      const result = await listTicketOperations();
      if (requestId !== requestRef.current) return;
      setOperations(result.operations.filter(isRecoverableTicketOperation));
      setError(null);
    } catch (caught) {
      if (requestId !== requestRef.current) return;
      setError(caught instanceof Error ? caught.message : 'Recovery status is unavailable.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [authLoading, user]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void refresh(), 0);
    return () => {
      window.clearTimeout(timeout);
      requestRef.current += 1;
    };
  }, [refresh]);

  const recover = useCallback(async (operation: TicketOperation) => {
    setBusyOperationId(operation.operation_id);
    setError(null);
    try {
      const result = isTicketOperationSyncRecovery(operation)
        ? await retryTicketOperationSync(operation.operation_id)
        : await resolveTicketOperation(operation.operation_id);
      setOperations((current) => {
        const remaining = current.filter(
          (item) => item.operation_id !== result.operation.operation_id,
        );
        return isRecoverableTicketOperation(result.operation)
          ? [result.operation, ...remaining]
          : remaining;
      });
      return result.operation;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Recovery failed.');
      throw caught;
    } finally {
      setBusyOperationId(null);
    }
  }, []);

  const remember = useCallback((operation: TicketOperation) => {
    setOperations((current) => {
      const remaining = current.filter((item) => item.operation_id !== operation.operation_id);
      return isRecoverableTicketOperation(operation)
        ? [operation, ...remaining]
        : remaining;
    });
  }, []);

  return {
    operations,
    loading,
    busyOperationId,
    error,
    refresh,
    recover,
    remember,
  };
}
