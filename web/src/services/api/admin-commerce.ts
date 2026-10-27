import { apiGet, apiPost, compactApiParams } from "@/services/api/request";
import type { CommerceSetting, PurchaseOrder } from "@/services/api/commerce";

export function fetchCommerceSettings(token: string) {
    return apiGet<CommerceSetting>("/api/admin/commerce/settings", undefined, token);
}

export function saveCommerceSettings(token: string, setting: CommerceSetting) {
    return apiPost<CommerceSetting>("/api/admin/commerce/settings", setting, token);
}

export function fetchAdminPurchaseOrders(token: string, query: { page: number; pageSize: number; status: string; kind: string; keyword: string }) {
    return apiGet<{ items: PurchaseOrder[]; total: number }>("/api/admin/purchase-orders", compactApiParams(query), token);
}

export function reviewPurchaseOrder(token: string, id: string, action: "complete" | "reject", remark: string) {
    return apiPost<PurchaseOrder>(`/api/admin/purchase-orders/${encodeURIComponent(id)}/review`, { action, remark }, token);
}
