import { apiGet, apiPost, compactApiParams } from "./request";

export type PurchaseKind = "credits" | "storage";
export type OrderStatus = "pending" | "completed" | "rejected" | "canceled";
export type CommercePlan = {
    id: string;
    name: string;
    kind: PurchaseKind;
    priceCents: number;
    credits: number;
    storageBytes: number;
    description: string;
    enabled: boolean;
    confirmation?: string;
};
export type CommerceSetting = {
    defaultStorageBytes: number;
    contactText: string;
    instructions: string;
    plans: CommercePlan[];
};
export type AccountWallet = {
    credits: number;
    storage: { usedBytes: number; limitBytes: number; baseBytes: number; extraBytes: number; remainingBytes: number; overLimit: boolean };
    commerce: CommerceSetting;
};
export type PurchaseOrder = {
    id: string;
    userId: string;
    userDisplayName?: string;
    planId: string;
    planName: string;
    kind: PurchaseKind;
    priceCents: number;
    credits: number;
    storageBytes: number;
    paymentMethod: "manual";
    status: OrderStatus;
    reviewRemark: string;
    reviewerId?: string;
    reviewedAt?: string;
    createdAt: string;
    updatedAt: string;
};

export function fetchAccountWallet(token: string) {
    return apiGet<AccountWallet>("/api/v1/wallet", undefined, token);
}

export function fetchPurchaseOrders(token: string, query: { page?: number; pageSize?: number; status?: OrderStatus | ""; kind?: PurchaseKind | "" } = {}) {
    return apiGet<{ items: PurchaseOrder[]; total: number }>("/api/v1/purchase-orders", compactApiParams(query), token);
}

export function createPurchaseOrder(token: string, input: { planId: string; requestId: string; confirmation: string }) {
    return apiPost<PurchaseOrder>("/api/v1/purchase-orders", input, token);
}

export function cancelPurchaseOrder(token: string, id: string) {
    return apiPost<PurchaseOrder>(`/api/v1/purchase-orders/${encodeURIComponent(id)}/cancel`, {}, token);
}
