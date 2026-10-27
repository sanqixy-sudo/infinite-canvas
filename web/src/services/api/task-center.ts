import { apiGet } from "./request";

export type TaskCenterItem = {
    id: string; kind: "image" | "video" | "audio" | "render"; title: string; model: string; status: string; progress: number;
    source: string; canvasId: string; nodeId: string; workspaceId: string; episodeId: string;
    workflow: boolean; gateway: boolean; archived: boolean; canStop: boolean; error: string; billingStatus: string;
    reservedCredits: number | null; settledCredits: number | null; chargedCredits: number | null; refundedCredits: number | null; netCredits: number | null;
    createdAt: string; updatedAt: string;
};
export type TaskCenterQuery = { type?: string; status?: string; keyword?: string; page: number; pageSize: number };
export type TaskCenterList = { items: TaskCenterItem[]; total: number; page: number; pageSize: number };
export const fetchTaskCenter = (token: string, query: TaskCenterQuery) => apiGet<TaskCenterList>("/api/v1/tasks", query, token);
