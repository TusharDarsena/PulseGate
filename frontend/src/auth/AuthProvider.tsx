import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { buildDelegatedSigners, provisionDelegatedWallet, recoverDelegatedWallet } from '../lib/dfns';
import { supabase } from '../lib/supabase';
import { EMPTY_ATTENDEE_WALLET, useAppStore } from '../store/useAppStore';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  walletRestoring: boolean;
  authError: string | null;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signInWithGoogle: (nonce: string) => Promise<void>;
  signOut: () => Promise<void>;
  provisionWallet: () => Promise<string>;
  recoverWallet: (recoveryCode: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [walletRestoring, setWalletRestoring] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const { setAttendeeWallet } = useAppStore();
  const activeUserIdRef = useRef<string | null>(null);
  const restorationRequestRef = useRef(0);

  const restoreWallet = useCallback(async (capturedSession: Session, requestId: number) => {
    const capturedUserId = capturedSession.user.id;
    const isCurrent = () =>
      restorationRequestRef.current === requestId &&
      activeUserIdRef.current === capturedUserId;

    const { data, error } = await supabase.rpc('get_my_attendee_wallet');
    if (error) throw error;
    if (!isCurrent()) return;

    const wallet = data?.[0] as { address: string | null; network: string; readiness: string } | undefined;
    if (!wallet) {
      setAttendeeWallet({ ...EMPTY_ATTENDEE_WALLET, readiness: 'not_provisioned' });
      return;
    }
    const readiness = wallet.readiness as 'provisioning' | 'ready' | 'recovery_required' | 'error';
    if (readiness !== 'ready' || !wallet.address) {
      setAttendeeWallet({
        ...EMPTY_ATTENDEE_WALLET,
        address: wallet.address,
        readiness,
      });
      return;
    }
    const signers = buildDelegatedSigners(wallet.address);
    setAttendeeWallet({
      address: wallet.address,
      network: 'StellarTestnet',
      readiness: 'ready',
      ...signers,
    });
  }, [setAttendeeWallet]);

  const runWalletRestoration = useCallback(async (
    capturedSession: Session,
    requestId: number,
  ) => {
    try {
      await restoreWallet(capturedSession, requestId);
    } catch (error) {
      if (
        restorationRequestRef.current === requestId &&
        activeUserIdRef.current === capturedSession.user.id
      ) {
        setAttendeeWallet({
          ...EMPTY_ATTENDEE_WALLET,
          readiness: 'error',
          errorMessage: error instanceof Error
            ? error.message
            : 'Wallet readiness could not be loaded.',
        });
      }
      throw error;
    } finally {
      if (
        restorationRequestRef.current === requestId &&
        activeUserIdRef.current === capturedSession.user.id
      ) {
        setWalletRestoring(false);
      }
    }
  }, [restoreWallet, setAttendeeWallet]);

  const restoreCurrentWallet = useCallback(async (capturedSession: Session) => {
    if (activeUserIdRef.current !== capturedSession.user.id) {
      throw new Error('Authentication session changed.');
    }
    const requestId = ++restorationRequestRef.current;
    setWalletRestoring(true);
    await runWalletRestoration(capturedSession, requestId);
  }, [runWalletRestoration]);

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      activeUserIdRef.current = next?.user.id ?? null;
      const requestId = ++restorationRequestRef.current;
      setSession(next);
      setLoading(false);
      if (!next) {
        setWalletRestoring(false);
        setAttendeeWallet(EMPTY_ATTENDEE_WALLET);
        return;
      }
      setWalletRestoring(true);
      queueMicrotask(() => void runWalletRestoration(next, requestId).catch(() => undefined));
    });
    return () => subscription.unsubscribe();
  }, [runWalletRestoration, setAttendeeWallet]);

  const sendEmailOtp = async (email: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  };

  const verifyEmailOtp = async (email: string, token: string) => {
    setAuthError(null);
    const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  };

  const signInWithGoogle = async (nonce: string) => {
    setAuthError(null);
    const callback = new URL('/auth/callback', window.location.origin);
    callback.searchParams.set('state', nonce);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    });
    if (error) {
      setAuthError(error.message);
      throw error;
    }
  };

  const signOut = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
    activeUserIdRef.current = null;
    restorationRequestRef.current += 1;
    setSession(null);
    setWalletRestoring(false);
    setAttendeeWallet(EMPTY_ATTENDEE_WALLET);
  };

  const provisionWallet = async () => {
    const capturedSession = session;
    if (!capturedSession) throw new Error('Sign in is required.');
    setAttendeeWallet({ ...EMPTY_ATTENDEE_WALLET, readiness: 'provisioning' });
    try {
      const recoveryCode = await provisionDelegatedWallet();
      await restoreCurrentWallet(capturedSession);
      return recoveryCode;
    } catch (error) {
      if (activeUserIdRef.current === capturedSession.user.id) {
        await restoreCurrentWallet(capturedSession).catch(() => setAttendeeWallet({
          ...EMPTY_ATTENDEE_WALLET,
          readiness: 'error',
          errorMessage: error instanceof Error
            ? error.message
            : 'Wallet setup could not be completed.',
        }));
      }
      throw error;
    }
  };

  const recoverWallet = async (recoveryCode: string) => {
    const capturedSession = session;
    if (!capturedSession) throw new Error('Sign in is required.');
    setAttendeeWallet({ ...EMPTY_ATTENDEE_WALLET, readiness: 'provisioning' });
    try {
      const nextRecoveryCode = await recoverDelegatedWallet(recoveryCode);
      await restoreCurrentWallet(capturedSession);
      return nextRecoveryCode;
    } catch (error) {
      if (activeUserIdRef.current === capturedSession.user.id) {
        setAttendeeWallet({
          ...EMPTY_ATTENDEE_WALLET,
          readiness: 'recovery_required',
          errorMessage: error instanceof Error ? error.message : 'Wallet recovery failed.',
        });
      }
      throw error;
    }
  };

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    walletRestoring,
    authError,
    sendEmailOtp,
    verifyEmailOtp,
    signInWithGoogle,
    signOut,
    provisionWallet,
    recoverWallet,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
