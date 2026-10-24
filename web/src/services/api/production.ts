import type { ProductionDocument } from "@/app/(user)/canvas/lib/production-types";
import { apiDelete, apiGet, apiPost } from "./request";
import type { VideoResponse } from "./video";

export const getProduction = (token: string, workspaceId: string) => apiGet<ProductionDocument | null>("/api/v1/productions", { workspaceId }, token);
export const createProduction = (token: string, workspaceId: string, title: string) => apiPost<ProductionDocument>("/api/v1/productions", { workspaceId, title }, token);
export const saveProduction = (token: string, document: ProductionDocument) => apiPost<ProductionDocument>("/api/v1/productions/save", document, token);
export const deleteProduction = (token: string, id: string, revision: number) => apiDelete<null>(`/api/v1/productions?id=${encodeURIComponent(id)}&revision=${revision}`, token);

/** Server-persisted task and ledger facts. Null is unavailable, never free. */
export type ProductionTask = {
    id: string; kind: "image" | "video" | "audio"; shotIds: string[]; canvasId: string; nodeId: string;
    model: string; status: string; progress: number; createdAt: string; billingStatus: string;
    reservedCredits: number | null; settledCredits: number | null;
    actualUnits?: number | null; actualTokens: number | null; actualInputTokens: number | null; actualOutputTokens: number | null;
    recordId: string; workspaceId: string; episodeIds: string[]; shotTitles: string[];
    updatedAt: string; completedAt: string; dispatchStatus: string; billingUnit: string;
    chargedCredits: number | null; refundedCredits: number | null; netCredits: number | null;
    canRetry: boolean; retryReason: string; retryOf?: string; attempt?: number;
};
export type ProductionCostSummary = {
    taskCount: number; settledTaskCount: number; unknownTaskCount: number; pendingTaskCount: number;
    settledCredits: number; heldCredits: number; chargedCredits: number; refundedCredits: number;
};
export type ProductionShotCost = ProductionCostSummary & { shotId: string; episodeId: string; shotTitle: string };
export type ProductionTaskList = {
    items: ProductionTask[]; total: number; page: number; pageSize: number; hasMore: boolean;
    summary: ProductionCostSummary; shotCosts: ProductionShotCost[]; historyScope: string; costScope: string;
};
export type ProductionTaskQuery = { episodeId?: string; status?: string; page?: number; pageSize?: number };
export const getProductionTasks = (token: string, workspaceId: string, query: ProductionTaskQuery = {}) => apiGet<ProductionTaskList>("/api/v1/productions/tasks", { workspaceId, ...query }, token);
export type ProductionRetryQuote = {
    accepted: false; quoteId: string; requestId: string; model: string; expiresAt: string; reserveCredits: number;
};
export type ProductionRetryAccepted = { accepted: true; task: VideoResponse };
export const quoteProductionRetry = (token: string, workspaceId: string, recordId: string, requestId: string) => apiPost<ProductionRetryQuote | ProductionRetryAccepted>("/api/v1/productions/tasks/retry", { workspaceId, recordId, requestId }, token);
export const submitProductionRetry = (token: string, workspaceId: string, recordId: string, quote: ProductionRetryQuote) => apiPost<ProductionRetryAccepted>("/api/v1/productions/tasks/retry", { workspaceId, recordId, requestId: quote.requestId, quoteId: quote.quoteId }, token);
