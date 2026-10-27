"use client";

import { useEffect } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { fetchAccountWallet } from "@/services/api/commerce";
import { useUserStore } from "@/stores/use-user-store";

export { ACCOUNT_WALLET_REFRESH_EVENT } from "@/lib/account-wallet-events";
export const accountWalletQueryKey = (token: string) => ["account-wallet", token] as const;

export function invalidateAccountWallet(client: QueryClient, token?: string) {
    return client.invalidateQueries({ queryKey: token ? accountWalletQueryKey(token) : ["account-wallet"] });
}

export function useAccountWallet() {
    const token = useUserStore((state) => state.token);
    const isReady = useUserStore((state) => state.isReady);
    const query = useQuery({
        queryKey: accountWalletQueryKey(token),
        queryFn: () => fetchAccountWallet(token),
        enabled: Boolean(isReady && token),
        refetchOnWindowFocus: true,
    });

    useEffect(() => {
        const session = useUserStore.getState();
        if (query.data && session.token === token && session.user && session.user.credits !== query.data.credits) {
            useUserStore.setState({ user: { ...session.user, credits: query.data.credits } });
        }
    }, [query.data, token]);

    return query;
}
