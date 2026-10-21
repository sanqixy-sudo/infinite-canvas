import { apiGet, apiPost, compactApiParams } from "@/services/api/request";

export const AUTH_TOKEN_KEY = "infinite-canvas-auth-token-v1";

export type UserRole = "guest" | "user" | "admin";

export type AuthUser = {
    id: string;
    username: string;
    displayName: string;
    avatarUrl: string;
    role: UserRole;
    credits: number;
    createdAt: string;
    updatedAt: string;
};

export type AuthSession = {
    token: string;
    user: AuthUser;
};

export type AuthPayload = {
    username: string;
    password: string;
};

export async function login(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/login", payload);
}

export async function register(payload: AuthPayload) {
    return apiPost<AuthSession>("/api/auth/register", payload);
}

export async function fetchCurrentUser(token?: string) {
    return apiGet<AuthUser>("/api/auth/me", undefined, token);
}

export type CreditLogType = "admin_adjust" | "ai_consume" | "ai_refund";

export type AccountCreditLog = {
    id: string;
    type: CreditLogType;
    amount: number;
    balance: number;
    relatedId: string;
    model: string;
    remark: string;
    createdAt: string;
};

export async function fetchAccountCreditLogs(token: string, query: { page?: number; pageSize?: number; type?: CreditLogType | "" } = {}) {
    return apiGet<{ items: AccountCreditLog[]; total: number }>("/api/v1/credit-logs", compactApiParams(query), token);
}
