export const ACCOUNT_WALLET_REFRESH_EVENT = "xiaomeng:account-wallet-refresh";

export function notifyAccountWalletRefresh() {
    if (typeof window !== "undefined") window.dispatchEvent(new Event(ACCOUNT_WALLET_REFRESH_EVENT));
}
