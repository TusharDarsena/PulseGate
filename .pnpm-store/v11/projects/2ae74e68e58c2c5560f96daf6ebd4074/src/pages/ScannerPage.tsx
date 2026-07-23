import React, { useState, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { useAppStore } from '../store/useAppStore';
import { verifyQRPayload } from '../lib/qr';
import { getTicket, markUsed } from '../lib/soroban';

import { fetchUserProfile } from '../lib/supabase';
import { mirrorUsedTicket, synchronizationWarning } from '../lib/readModelSync';

interface ScannerPageProps {
  invalidateTickets: () => void;
}

export function ScannerPage({ invalidateTickets }: ScannerPageProps) {
  const [scanResult, setScanResult] = useState<'idle' | 'success' | 'error'>('idle');
  const [scanDetails, setScanDetails] = useState<{ ticketId: string; walletAddress: string } | null>(null);
  const [attendeeProfile, setAttendeeProfile] = useState<{ displayName: string; avatarUrl: string } | null>(null);
  const [syncWarning, setSyncWarning] = useState<string | null>(null);
  const { organizerWallet: wallet } = useAppStore();
  const scannerRef = React.useRef<Html5Qrcode | null>(null);

  const handleScan = React.useCallback(async (data: string) => {
    setSyncWarning(null);
    // Pause immediately to prevent spam
    if (scannerRef.current) {
      scannerRef.current.pause(true);
    }
    // Step 1: Verify format, timestamp, and ed25519 signature locally. (D-005, D-006)
    const parsed = verifyQRPayload(data);
    if (!parsed) {
      setScanResult('error');
      setScanDetails(null);
      return;
    }

    // Step 2: Confirm on-chain that the ticket is Active and the owner matches.
    const ticket = await getTicket(parsed.ticketId);
    if (!ticket || ticket.status !== 'Active' || ticket.owner !== parsed.walletAddress) {
      setScanResult('error');
      setScanDetails(null);
      return;
    }

    // Step 3: Fetch Attendee Profile from Supabase
    const profileData = await fetchUserProfile(parsed.walletAddress);

    if (profileData) {
      setAttendeeProfile({
        displayName: profileData.display_name || 'Anonymous Attendee',
        avatarUrl: profileData.avatar_url || 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&q=80',
      });
    } else {
      setAttendeeProfile(null);
    }

    // Step 4: Mark ticket as used on-chain. Requires organizer wallet. (D-005)
    if (!wallet.publicKey || !wallet.signFn) {
      setScanResult('error');
      setScanDetails(null);
      return;
    }

    try {
      await markUsed(parsed.ticketId, wallet.publicKey, wallet.signFn);
      const syncResult = await mirrorUsedTicket(parsed.ticketId);
      if (syncResult.ok) {
        invalidateTickets();
        setSyncWarning(null);
      } else {
        setSyncWarning(synchronizationWarning(syncResult));
      }
      setScanDetails(parsed);
      setScanResult('success');
    } catch (err) {
      console.error('[ScannerPage] markUsed failed:', err);
      setScanResult('error');
      setScanDetails(null);
    }
  }, [wallet.publicKey, wallet.signFn, invalidateTickets]);

  useEffect(() => {
    // Slight delay to ensure DOM is ready
    const timer = setTimeout(() => {
      scannerRef.current = new Html5Qrcode("qr-reader");
      scannerRef.current.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: { width: 250, height: 250 } },
        (decodedText) => {
          handleScan(decodedText);
        },
        () => {
          // ignore parse errors
        }
      ).catch(err => {
        console.error("Failed to start scanner:", err);
      });
    }, 100);

    return () => {
      clearTimeout(timer);
      if (scannerRef.current && scannerRef.current.isScanning) {
        scannerRef.current.stop().catch(console.error);
      }
    };
  }, [handleScan]);

  // Dev-only buttons — render behind import.meta.env.DEV guard so they tree-shake in prod.
  const DEV_MODE = import.meta.env.DEV;

  return (
    <div className="bg-black text-[#e6e0ee] font-sans overflow-hidden h-screen flex flex-col pt-24">

      {/* Main Viewport */}
      <main className="flex-grow relative flex flex-col overflow-hidden bg-black">
        {/* Camera Viewport */}
        <div className="absolute inset-0 z-0 overflow-hidden bg-neutral-900">
          <div id="qr-reader" className="w-full h-full [&>video]:object-cover [&>video]:w-full [&>video]:h-full border-none"></div>
          
          {/* Central Focus Area Overlay */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="relative w-72 h-72 md:w-96 md:h-96">
              <div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-[#7C5CFF]"></div>
              <div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-[#7C5CFF]"></div>
              <div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-[#7C5CFF]"></div>
              <div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-[#7C5CFF]"></div>
              
              {/* Scanning Line Animation Simulation */}
              <div className="absolute top-1/2 left-4 right-4 h-0.5 bg-[#7C5CFF] shadow-[0_0_15px_#7C5CFF]"></div>
              <div className="absolute inset-0 flex items-center justify-center opacity-10">
                <span className="material-symbols-outlined text-9xl text-white">qr_code_scanner</span>
              </div>
            </div>
          </div>
        </div>

        {/* UI Overlays */}
        <div className="relative z-10 h-full flex flex-col justify-between p-6 pointer-events-none">
          {/* Top Guidance */}
          <div className="w-full flex justify-center pt-8">
            <div className="bg-[#1c1a24]/80 backdrop-blur-md px-6 py-3 rounded-full border border-[#484555]/30 flex items-center gap-3">
              <span className="material-symbols-outlined text-[#7C5CFF]">center_focus_weak</span>
              <p className="text-sm">Position the QR code within the frame</p>
            </div>
          </div>
          
          {/* Controls & Mock States */}
          <div className="flex flex-col items-center gap-6 pb-16 pointer-events-auto">
            <button className="bg-[#7C5CFF] text-white font-semibold px-12 py-4 rounded-xl shadow-[0_0_30px_rgba(124,92,255,0.4)] flex items-center gap-3 active:scale-95 transition-all">
              <span className="material-symbols-outlined">photo_camera</span>
              START SCANNING
            </button>
            <div className="flex items-center gap-3 p-2 bg-[#36333e]/60 backdrop-blur-sm rounded-lg border border-[#484555]">
              {DEV_MODE && (
                <>
                  <button
                    onClick={() => {
                      // Simulate a valid but unverifiable payload for UI testing
                      // In dev, verifyQRPayload will fail (no real secret) so we set success directly
                      setScanDetails({ ticketId: 'dev-ticket-id', walletAddress: wallet.publicKey ?? 'GTEST' });
                      setScanResult('success');
                    }}
                    className="px-4 py-2 bg-emerald-500/20 text-emerald-400 font-bold text-[10px] rounded border border-emerald-500/30 hover:bg-emerald-500/30 transition-colors uppercase tracking-widest"
                  >
                    Mock Valid
                  </button>
                  <button
                    onClick={() => handleScan('invalid:data:0')}
                    className="px-4 py-2 bg-red-500/20 text-red-400 font-bold text-[10px] rounded border border-red-500/30 hover:bg-red-500/30 transition-colors uppercase tracking-widest"
                  >
                    Mock Error
                  </button>
                </>
              )}
              <button
                className="px-4 py-2 bg-[#7C5CFF]/10 text-[#7C5CFF] font-bold text-[10px] rounded border border-[#7C5CFF]/30 hover:bg-[#7C5CFF]/20 transition-colors uppercase tracking-widest"
              >
                Flash Toggle
              </button>
            </div>
          </div>
        </div>

        {/* VALID SCAN OVERLAY (Success State) */}
        {scanResult === 'success' && (
          <div className="absolute inset-0 z-50 bg-[#14121b]/85 backdrop-blur-md flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-[#0f0d16] border border-[#7C5CFF]/30 rounded-xl overflow-hidden shadow-2xl">
              <div className="bg-emerald-500/10 border-b border-emerald-500/20 p-8 flex flex-col items-center gap-4 text-center">
                <div className="w-20 h-20 bg-emerald-500 rounded-full flex items-center justify-center shadow-[0_0_25px_rgba(16,185,129,0.5)]">
                  <span className="material-symbols-outlined text-white text-5xl" style={{ fontVariationSettings: "'wght' 700" }}>check</span>
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold text-emerald-400">Entry Granted</h2>
                  <p className="text-sm text-[#c9c4d8]">Validated via Stellar Ledger</p>
                </div>
              </div>
              <div className="p-8 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-[#484555]">
                    <img className="w-full h-full object-cover" src={attendeeProfile?.avatarUrl ?? "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?w=100&q=80"} alt="Attendee" />
                  </div>
                  <div className="text-left">
                    <p className="text-xs font-semibold text-[#7C5CFF] uppercase">Attendee</p>
                    <h3 className="text-xl font-bold text-white">
                      {attendeeProfile?.displayName ?? `${scanDetails?.walletAddress.slice(0,6)}...${scanDetails?.walletAddress.slice(-4)}`}
                    </h3>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#2b2933] p-4 rounded-lg border border-[#484555] text-left">
                    <p className="text-xs font-semibold text-[#c9c4d8] mb-1">TICKET TYPE</p>
                    <p className="text-base font-bold text-white">General Admission</p>
                  </div>
                  <div className="bg-[#2b2933] p-4 rounded-lg border border-[#484555] text-left">
                    <p className="text-xs font-semibold text-[#c9c4d8] mb-1">SEAT / SECTION</p>
                    <p className="text-base font-bold text-white">Anywhere</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-semibold text-[#c9c4d8]">TICKET ID</span>
                    <span className="font-mono text-sm text-[#7C5CFF]">
                      {scanDetails?.ticketId.substring(0, 12)}...
                    </span>
                  </div>
                  <div className="flex justify-between items-center px-1">
                    <span className="text-xs font-semibold text-[#c9c4d8]">WALLET</span>
                    <span className="font-mono text-xs text-[#7C5CFF]">
                      {scanDetails ? `${scanDetails.walletAddress.slice(0,4)}...${scanDetails.walletAddress.slice(-4)}` : '—'}
                    </span>
                  </div>
                  <div className="w-full h-1 bg-[#36333e] rounded-full overflow-hidden">
                    <div className="w-full h-full bg-emerald-500"></div>
                  </div>
                </div>
                {syncWarning && (
                  <p className="rounded-lg bg-amber-500/10 p-3 text-left text-xs text-amber-300">
                    {syncWarning}
                  </p>
                )}
                <button 
                  onClick={() => {
                    setScanResult('idle');
                    if (scannerRef.current) scannerRef.current.resume();
                  }}
                  className="w-full bg-[#7C5CFF] text-white font-semibold text-xl py-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-transform"
                >
                  <span className="material-symbols-outlined">refresh</span>
                  SCAN NEXT
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* ERROR SCAN OVERLAY */}
        {scanResult === 'error' && (
          <div className="absolute inset-0 z-50 bg-[#14121b]/85 backdrop-blur-md flex items-center justify-center p-6">
            <div className="w-full max-w-md bg-[#0f0d16] border border-red-500/30 rounded-xl overflow-hidden shadow-2xl">
              <div className="bg-red-500/10 border-b border-red-500/20 p-8 flex flex-col items-center gap-4 text-center">
                <div className="w-20 h-20 bg-red-500 rounded-full flex items-center justify-center shadow-[0_0_25px_rgba(239,68,68,0.5)]">
                  <span className="material-symbols-outlined text-white text-5xl" style={{ fontVariationSettings: "'wght' 700" }}>close</span>
                </div>
                <div className="space-y-1">
                  <h2 className="text-2xl font-bold text-red-400">Invalid Ticket</h2>
                  <p className="text-sm text-[#c9c4d8]">Ticket already used or not found</p>
                </div>
              </div>
              <div className="p-8">
                <button 
                  onClick={() => {
                    setScanResult('idle');
                    if (scannerRef.current) scannerRef.current.resume();
                  }}
                  className="w-full bg-[#272C33] text-white font-semibold text-xl py-4 rounded-xl flex items-center justify-center gap-3 active:scale-95 transition-transform hover:bg-[#36333e]"
                >
                  <span className="material-symbols-outlined">refresh</span>
                  TRY AGAIN
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
