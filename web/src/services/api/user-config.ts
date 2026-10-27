import { apiDelete, apiGet, apiPost } from "@/services/api/request";
import type { Asset } from "@/stores/use-asset-store";
import type { AssetOrganizationSnapshot } from "./asset-organization";
import type { AiConfig } from "@/stores/use-config-store";
import type { WorkflowChannelData, WorkflowRef } from "@/lib/workflow-channel";
import type { ChannelTranslation } from "@/lib/channel-parameter-translation";
import { toProviderPayload, type UserS3StorageProvider, type UserStorageProvider, type UserWebDAVStorageProvider } from "@/services/image-storage";

export type UserConfigPayload = {
    modelConfig?: Partial<AiConfig> & { workflowChannels?: WorkflowChannelData[]; channelTranslations?: ChannelTranslation[] };
    storageProvider?: {
        s3?: Partial<UserS3StorageProvider>;
        webdav?: Partial<UserWebDAVStorageProvider>;
    };
    imageHistory?: unknown;
    assetData?: unknown;
    syncCapabilities?: {
        userData?: boolean;
        workflows?: boolean;
        assets?: boolean;
    };
};

export type StorageCapacityResult = {
    bytes: number;
    limitBytes: number;
    overLimit: boolean;
    checkedAt: string;
    providerName: string;
};

export async function fetchUserConfig(token: string) {
    return apiGet<UserConfigPayload>("/api/v1/user-config", undefined, token);
}

const cloudPreferenceKeys = [
    "model", "imageModel", "videoModel", "textModel", "audioModel",
    "activeChannelId", "imageChannelId", "videoChannelId", "textChannelId", "audioChannelId",
    "audioVoice", "audioFormat", "audioSpeed", "audioInstructions",
    "grokTtsVoice", "grokTtsLanguage", "grokTtsFormat", "grokTtsSpeed",
    "glmTtsVoice", "glmTtsFormat", "glmTtsSpeed", "mimoTtsVoice", "mimoTtsFormat", "mimoVoiceDesignPrompt", "geminiTtsVoice",
    "videoSeconds", "videoMode", "videoNegativePrompt", "videoMultiShot", "videoShotType", "videoMultiPrompt", "videoElementList",
    "vquality", "videoGenerateAudio", "videoWatermark", "videoCharacterOrientation",
    "quality", "size", "videoSize", "count", "canvasImageCount", "timeout", "apiMode",
    "streamImages", "streamPartialImages", "responseFormatB64Json", "systemPrompt", "systemPrompts",
    "syncStorageConfig", "syncWebDAVStorageConfig",
] as const satisfies readonly (keyof AiConfig)[];

export function cloudModelPreferences(config: Partial<AiConfig>): Partial<AiConfig> {
    const preferences = Object.fromEntries(cloudPreferenceKeys.filter((key) => config[key] !== undefined).map((key) => [key, config[key]]));
    const systemWorkflow = (ref?: WorkflowRef): WorkflowRef | undefined => ref?.scope === "system" && typeof ref.channelId === "string" && typeof ref.workflowId === "string" && (ref.kind === "workflow" || ref.kind === "app")
        ? { scope: "system", channelId: ref.channelId, kind: ref.kind, workflowId: ref.workflowId }
        : undefined;
    return {
        ...preferences,
        channelMode: "remote",
        imageWorkflowRef: systemWorkflow(config.imageWorkflowRef),
        videoWorkflowRef: systemWorkflow(config.videoWorkflowRef),
        audioWorkflowRef: systemWorkflow(config.audioWorkflowRef),
    };
}

export async function syncUserModelConfig(token: string, config: Partial<AiConfig>) {
    return apiPost<UserConfigPayload>("/api/v1/user-config/model", { config: cloudModelPreferences(config) }, token);
}

export type UserStorageProviders = {
    s3?: UserS3StorageProvider;
    webdav?: UserWebDAVStorageProvider;
};

export async function syncUserStorageProvider(token: string, provider: UserStorageProviders) {
    return apiPost<UserConfigPayload>("/api/v1/user-config/storage", {
        provider: {
            ...(provider.s3 ? { s3: toProviderPayload(provider.s3) } : {}),
            ...(provider.webdav ? { webdav: toProviderPayload(provider.webdav) } : {}),
        },
    }, token);
}

export async function measureUserStorageProvider(token: string, provider: UserStorageProvider) {
    return apiPost<StorageCapacityResult>("/api/v1/storage/measure", { provider: toProviderPayload(provider) }, token);
}

export async function fetchUserImageHistory<T>(token: string) {
    return apiGet<T>("/api/v1/user-data/image-history", undefined, token);
}

export async function syncUserImageHistory<T>(token: string, data: T) {
    return apiPost<T>("/api/v1/user-data/image-history", { data }, token);
}

export async function fetchUserAssetData<T>(token: string) {
    return apiGet<T>("/api/v1/user-data/assets", undefined, token);
}

export async function syncUserAssetData<T>(token: string, data: T) {
    return apiPost<T>("/api/v1/user-data/assets", { data }, token);
}

export function saveUserAssetItem(token: string, asset: Asset) {
    return apiPost<AssetOrganizationSnapshot>("/api/v1/user-data/assets/item", { asset }, token);
}

export function deleteUserAssetItem(token: string, id: string) {
    return apiDelete<AssetOrganizationSnapshot>(`/api/v1/user-data/assets/item/${encodeURIComponent(id)}`, token);
}

export type CreativeWorkflowRecord<T = unknown> = {
    id: string;
    ownerUserId?: string;
    scope: "private" | "public";
    name: string;
    category: string;
    description: string;
    data: T;
    createdAt: string;
    updatedAt: string;
    lastRunAt?: string;
    editable: boolean;
};

export async function fetchUserWorkflows<T>(token: string) {
    return apiGet<Array<CreativeWorkflowRecord<T>>>("/api/v1/workflows", undefined, token);
}

export async function saveUserWorkflow<T>(token: string, workflow: CreativeWorkflowRecord<T>) {
    return apiPost<CreativeWorkflowRecord<T>>("/api/v1/workflows", workflow, token);
}

export async function deleteUserWorkflow(token: string, id: string) {
    return apiDelete<boolean>(`/api/v1/workflows/${encodeURIComponent(id)}`, token);
}

export type WorkflowAgentDraftResponse<T = unknown> = {
    draft: T;
    warnings: string[];
    model: string;
};

export async function draftUserWorkflow<T>(
    token: string,
    payload: {
        prompt: string;
        scope: "private" | "public";
        model?: string;
        channelId?: string;
        channelMode?: "remote";
        references?: string[];
    },
) {
    return apiPost<WorkflowAgentDraftResponse<T>>("/api/v1/workflows/agent-draft", payload, token);
}
