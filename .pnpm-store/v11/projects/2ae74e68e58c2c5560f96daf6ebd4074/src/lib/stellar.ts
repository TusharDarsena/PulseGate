/**
 * Read a public Stellar Testnet balance. Wallet creation, recovery, and funding
 * are deliberately not performed in the browser.
 */
export async function fetchXlmBalance(publicKey: string): Promise<string> {
  const response = await fetch(`https://horizon-testnet.stellar.org/accounts/${publicKey}`);
  if (response.status === 404) return '0.00';
  if (!response.ok) throw new Error(`Horizon balance lookup failed (${response.status}).`);
  const data = await response.json() as {
    balances: Array<{ asset_type: string; balance: string }>;
  };
  const native = data.balances.find((balance) => balance.asset_type === 'native');
  return native ? Number.parseFloat(native.balance).toFixed(2) : '0.00';
}
