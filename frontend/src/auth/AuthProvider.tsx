import type { Session, User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { buildDelegatedSigners, provisionDelegatedWallet, recoverDelegatedWallet } from '../lib/dfns';
import { supabase } from '../lib/supabase';
import { EMPTY_ATTENDEE_WALLET, useAppStore } from '../store/useAppStore';

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  loading: boolean;
  authError: string | null;
  sendEmailOtp: (email: string) => Promise<void>;
  verifyEmailOtp: (email: string, token: string) => Promise<void>;
  signInWithGoogle: (nonce: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshWallet: () => Promise<void>;
  provisionWallet: () => Promise<string>;
  recoverWallet: (recoveryCode: string) => Promise<string>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const { setAttendeeWallet } = useAppStore();

  const refreshWallet = useCallback(async () => {
    const { data: { session: current } } = await supabase.auth.getSession();
    if (!current) {
      setAttendeeWallet(EMPTY_ATTENDEE_WALLET);
      return;
    }
    const { data, error } = await supabase.rpc('get_my_attendee_wallet');
    if (error) throw error;
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

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
      setLoading(false);
      queueMicrotask(() => void refreshWallet().catch((error) => {
        setAttendeeWallet({
          ...EMPTY_ATTENDEE_WALLET,
          readiness: 'error',
          errorMessage: error instanceof Error ? error.message : 'Wallet readiness could not be loaded.',
        });
      }));
    });
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      return refreshWallet();
    });
    return () => subscription.unsubscribe();
  }, [refreshWallet, setAttendeeWallet]);

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
    setAttendeeWallet(EMPTY_ATTENDEE_WALLET);
  };

  const provisionWallet = async () => {
    setAttendeeWallet({ ...EMPTY_ATTENDEE_WALLET, readiness: 'provisioning' });
    try {
      const recoveryCode = await provisionDelegatedWallet();
      await refreshWallet();
      return recoveryCode;
    } catch (error) {
      await refreshWallet().catch(() => setAttendeeWallet({
        ...EMPTY_ATTENDEE_WALLET,
        readiness: 'error',
        errorMessage: error instanceof Error ? error.message : 'Wallet setup could not be completed.',
      }));
      throw error;
    }
  };

  const recoverWallet = async (recoveryCode: string) => {
    setAttendeeWallet({ ...EMPTY_ATTENDEE_WALLET, readiness: 'provisioning' });
    try {
      const nextRecoveryCode = await recoverDelegatedWallet(recoveryCode);
      await refreshWallet();
      return nextRecoveryCode;
    } catch (error) {
      setAttendeeWallet({
        ...EMPTY_ATTENDEE_WALLET,
        readiness: 'recovery_required',
        errorMessage: error instanceof Error ? error.message : 'Wallet recovery failed.',
      });
      throw error;
    }
  };

  const value: AuthContextValue = {
    session,
    user: session?.user ?? null,
    loading,
    authError,
    sendEmailOtp,
    verifyEmailOtp,
    signInWithGoogle,
    signOut,
    refreshWallet,
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
