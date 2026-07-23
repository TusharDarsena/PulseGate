import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider';
import { useWallet } from '../hooks/useWallet';
import { useAppStore } from '../store/useAppStore';
import { truncateKey } from '../types';

export function AccountPage() {
  const { user, signOut, provisionWallet, recoverWallet } = useAuth();
  const { attendeeWallet, organizerWallet } = useAppStore();
  const { connectOrganizer, disconnectOrganizer } = useWallet();
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [enteredRecoveryCode, setEnteredRecoveryCode] = useState('');
  const [showRecovery, setShowRecovery] = useState(false);
  const navigate = useNavigate();

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The action could not be completed.');
    }
  };

  return (
    <main className="pt-24 pb-24 px-4 max-w-3xl mx-auto min-h-screen">
      <h1 className="text-4xl font-bold mb-8">Account</h1>
      <section className="bg-[#15181C] border border-[#272C33] rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-3">Signed-in account</h2>
        <p className="text-slate-300">{user?.email ?? 'Authenticated user'}</p>
        <p className="text-xs text-slate-500 mt-1">Account ID: {user?.id}</p>
      </section>

      <section className="bg-[#15181C] border border-[#272C33] rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-3">Ticket wallet</h2>
        <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
          <div><dt className="text-slate-500">Network</dt><dd>Stellar Testnet</dd></div>
          <div><dt className="text-slate-500">Readiness</dt><dd className="capitalize">{attendeeWallet.readiness.replace('_', ' ')}</dd></div>
          <div><dt className="text-slate-500">Address</dt><dd className="font-mono">{attendeeWallet.address ? truncateKey(attendeeWallet.address) : 'Not provisioned'}</dd></div>
        </dl>
        {attendeeWallet.readiness === 'not_provisioned' && (
          <button onClick={() => void run(async () => {
            const code = await provisionWallet();
            setRecoveryCode(code);
          })} className="mt-5 bg-[#7C5CFF] px-4 py-2 rounded-lg">
            Prepare ticket wallet
          </button>
        )}
        {recoveryCode && (
          <div className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
            <p className="font-semibold text-emerald-300">Save this recovery code now</p>
            <p className="my-3 break-all rounded bg-black/30 p-3 font-mono text-sm">{recoveryCode}</p>
            <p className="text-xs text-slate-300">
              Store it in a password manager. StellarTickets does not retain this code and cannot
              silently replace your wallet if it is lost.
            </p>
            <button onClick={() => setRecoveryCode(null)} className="mt-3 underline text-sm">I saved it</button>
          </div>
        )}
        {attendeeWallet.readiness === 'ready' && !showRecovery && (
          <button onClick={() => setShowRecovery(true)} className="mt-5 text-sm underline text-slate-300">
            Restore signing on this device
          </button>
        )}
        {(attendeeWallet.readiness === 'recovery_required' || showRecovery) && (
          <div className="mt-5 bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded-lg p-4">
            <p className="mb-3">Wallet recovery is required. A replacement wallet will not be created.</p>
            <input
              type="password"
              value={enteredRecoveryCode}
              onChange={(event) => setEnteredRecoveryCode(event.target.value)}
              placeholder="Recovery code"
              className="w-full rounded bg-black/30 border border-amber-500/30 p-3 text-white"
            />
            <button
              onClick={() => void run(async () => {
                const nextCode = await recoverWallet(enteredRecoveryCode);
                setEnteredRecoveryCode('');
                setShowRecovery(false);
                setRecoveryCode(nextCode);
              })}
              disabled={!enteredRecoveryCode}
              className="mt-3 bg-amber-500 text-black px-4 py-2 rounded disabled:opacity-50"
            >
              Recover recorded wallet
            </button>
          </div>
        )}
      </section>

      <section className="bg-[#15181C] border border-[#272C33] rounded-xl p-6 mb-6">
        <h2 className="text-xl font-semibold mb-3">Organizer wallet</h2>
        <p className="text-slate-400 text-sm mb-4">Freighter is separate from your ticket wallet.</p>
        {organizerWallet.isConnected ? (
          <>
            <p className="font-mono text-sm">{organizerWallet.publicKey}</p>
            <div className="flex gap-3 mt-4">
              <button onClick={() => navigate('/organizer/events')} className="bg-[#7C5CFF] px-4 py-2 rounded-lg">Manage events</button>
              <button onClick={disconnectOrganizer} className="bg-[#272C33] px-4 py-2 rounded-lg">Disconnect Freighter</button>
            </div>
          </>
        ) : (
          <button onClick={() => void run(connectOrganizer)} className="bg-[#272C33] px-4 py-2 rounded-lg">Connect Freighter</button>
        )}
        {organizerWallet.errorMessage && <p className="text-red-400 text-sm mt-3">{organizerWallet.errorMessage}</p>}
      </section>

      {error && <p role="alert" className="text-red-400 mb-4">{error}</p>}
      <button onClick={() => void run(async () => { await signOut(); navigate('/events'); })}
        className="border border-red-500/40 text-red-300 px-4 py-2 rounded-lg">
        Sign out
      </button>
    </main>
  );
}
