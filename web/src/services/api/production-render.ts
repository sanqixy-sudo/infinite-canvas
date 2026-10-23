import { apiGet, apiPost } from "./request";

export type ProductionRenderJob = { id: string; requestId: string; workspaceId: string; episodeId: string; episodeTitle: string; revision: number; status: "queued" | "running" | "completed" | "failed" | "cancelled"; progress: number; seconds: number; shotCount: number; attempts: number; error: string; outputStorageKey: string; outputBytes: number; createdAt: string; updatedAt: string };
export type ProductionRenderInput = { workspaceId: string; episodeId: string; revision: number; requestId: string };

export function fetchProductionRenders(token: string, workspaceId: string) {
    return apiGet<ProductionRenderJob[]>("/api/v1/productions/renders", { workspaceId }, token);
}
export function createProductionRender(token: string, input: ProductionRenderInput) {
    return apiPost<ProductionRenderJob>("/api/v1/productions/renders", input, token);
}
export function fetchProductionRenderByRequest(token: string, requestId: string) {
    return apiGet<ProductionRenderJob | null>("/api/v1/productions/renders/request", { requestId }, token);
}
export function actionProductionRender(token: string, id: string, action: "retry" | "cancel") {
    return apiPost<ProductionRenderJob>("/api/v1/productions/renders/action", { id, action }, token);
}
export function cancelProductionRenderRequest(token: string, requestId: string) {
    return apiPost<ProductionRenderJob>("/api/v1/productions/renders/action", { requestId, action: "cancel-request" }, token);
}
