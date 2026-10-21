import { apiPost } from "@/services/api/request";
import { requireCloudModelAccess } from "./cloud-model-access";

export type AutoDLInputRule = {
    type: string;
    required?: boolean;
    default?: string | number;
    min?: number;
    max?: number;
};

export type AutoDLWorkflow = {
    uuid: string;
    name: string;
    kind: "video" | "audio" | "unsupported";
    input_rules?: Record<string, AutoDLInputRule>;
};

export function fetchAutoDLWorkflows(channelId: string) {
	return apiPost<AutoDLWorkflow[]>("/api/ai/autodl/workflows", { channelId }, requireCloudModelAccess());
}

export function fetchAutoDLWorkflow(channelId: string, workflowId: string) {
	return apiPost<AutoDLWorkflow>("/api/ai/autodl/workflows", { channelId, workflowId }, requireCloudModelAccess());
}
