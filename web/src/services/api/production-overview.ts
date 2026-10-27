import { apiGet } from "./request";
import type { ProductionRenderJob } from "./production-render";

export type ProductionOverview = { id: string; workspaceId: string; title: string; synopsis: string; revision: number; updatedAt: string; episodeCount: number; shotCount: number; assetCount: number; selectedShotCount: number; renderCount: number };
export type ProductionDeliveryItem = ProductionRenderJob & { projectTitle: string; fileAvailable: boolean };
export type ProductionPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export const getProductionOverview = (token: string, query: { keyword?: string; page?: number; pageSize?: number } = {}) => apiGet<ProductionPage<ProductionOverview>>("/api/v1/productions/overview", query, token);
export const getProductionDeliveries = (token: string, query: { keyword?: string; type?: string; workspaceId?: string; page?: number; pageSize?: number } = {}) => apiGet<ProductionPage<ProductionDeliveryItem>>("/api/v1/productions/deliveries", query, token);
