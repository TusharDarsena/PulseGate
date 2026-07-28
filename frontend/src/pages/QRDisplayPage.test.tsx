import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QRDisplayPage } from './QRDisplayPage';

const mocks = vi.hoisted(() => ({
  buildQRPayload: vi.fn(),
  getTicket: vi.fn(),
  wallet: {
    address: 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
    readiness: 'ready',
    signMessage: vi.fn(),
  },
}));
const ADDRESS = mocks.wallet.address;

vi.mock('qrcode.react', () => ({ QRCodeSVG: () => <div data-testid="qr-code" /> }));

vi.mock('../lib/qr', () => ({ buildQRPayload: mocks.buildQRPayload }));
vi.mock('../lib/soroban', () => ({ getTicket: mocks.getTicket }));
vi.mock('../store/useAppStore', () => ({
  useAppStore: (selector: (state: { attendeeWallet: typeof mocks.wallet }) => unknown) =>
    selector({ attendeeWallet: mocks.wallet }),
}));

describe('QRDisplayPage', () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.wallet = { address: ADDRESS, readiness: 'ready', signMessage: vi.fn() };
    mocks.getTicket.mockResolvedValue({ owner: ADDRESS, status: 'Active' });
    mocks.buildQRPayload.mockResolvedValue('signed-qr-payload');
  });

  it('checks authoritative ownership and Active status before each QR signature', async () => {
    render(<QRDisplayPage ticketId="ticket-1" />);

    await waitFor(() => expect(mocks.buildQRPayload).toHaveBeenCalledTimes(1));
    expect(mocks.getTicket).toHaveBeenCalledWith('ticket-1');
    expect(mocks.getTicket.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.buildQRPayload.mock.invocationCallOrder[0]);

    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(mocks.buildQRPayload).toHaveBeenCalledTimes(2));
    expect(mocks.getTicket).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('qr-code')).toBeInTheDocument();
  });

  it('does not sign when the on-chain ticket is no longer owned by the attendee', async () => {
    mocks.getTicket.mockResolvedValue({ owner: 'GDIFFERENTOWNER', status: 'Active' });

    render(<QRDisplayPage ticketId="ticket-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('not owned by the restored attendee wallet');
    expect(mocks.buildQRPayload).not.toHaveBeenCalled();
  });

  it('does not sign a ticket that is no longer Active', async () => {
    mocks.getTicket.mockResolvedValue({ owner: mocks.wallet.address, status: 'Used' });

    render(<QRDisplayPage ticketId="ticket-1" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('used and cannot generate entry QR');
    expect(mocks.buildQRPayload).not.toHaveBeenCalled();
  });
});
