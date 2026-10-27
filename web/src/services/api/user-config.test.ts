import assert from "node:assert/strict";
import test from "node:test";
import axios from "axios";

import type { WorkflowRef } from "@/lib/workflow-channel";
import type { AiConfig } from "@/stores/use-config-store";
import { cloudModelPreferences, syncUserModelConfig } from "./user-config";

function legacyModelConfig() {
    return {
        channelMode: "local",
        baseUrl: "https://personal.invalid",
        apiKey: "private-model-key",
        localChannels: [{ id: "personal", protocol: "openai", name: "个人渠道", baseUrl: "https://personal.invalid", apiKey: "private-model-key", models: ["private-image"] }],
        publicChannels: [{ id: "outdated", models: ["outdated-image"] }],
        models: ["private-image"],
        imageModels: ["private-image"],
        videoModels: ["private-video"],
        textModels: ["private-text"],
        audioModels: ["private-audio"],
        workflowChannels: [{ channelId: "personal", protocol: "runninghub", workflows: [] }],
        channelTranslations: [{ channelId: "personal", parameterTranslation: "private-protocol-source" }],
        codexCli: "private-cli-command",
        workflowSyncTouched: true,
        imageModel: "studio-image",
        imageChannelId: "platform",
        canvasImageCount: "2",
        audioSpeed: "1.2",
        syncStorageConfig: false,
        syncWebDAVStorageConfig: true,
        imageWorkflowRef: { scope: "personal", channelId: "personal", kind: "workflow", workflowId: "private-workflow" },
    } as Partial<AiConfig>;
}

test("cloud preferences whitelist excludes saved credentials, personal channels and model inventories", () => {
    const stored = legacyModelConfig();
    const before = structuredClone(stored);
    const preferences = cloudModelPreferences(stored);
    for (const key of ["apiKey", "baseUrl", "localChannels", "publicChannels", "models", "imageModels", "videoModels", "textModels", "audioModels", "workflowChannels", "channelTranslations", "codexCli", "workflowSyncTouched"]) {
        assert.equal(Object.hasOwn(preferences, key), false, key);
    }
    assert.equal(preferences.channelMode, "remote");
    assert.equal(preferences.imageModel, "studio-image");
    assert.equal(preferences.imageChannelId, "platform");
    assert.equal(preferences.canvasImageCount, "2");
    assert.equal(preferences.audioSpeed, "1.2");
    assert.equal(preferences.syncStorageConfig, false);
    assert.equal(preferences.syncWebDAVStorageConfig, true);
    assert.equal(preferences.imageWorkflowRef, undefined);
    assert.deepEqual(stored, before);
});

test("system workflow references retain only their four public identity fields", () => {
    const systemRef = { scope: "system", channelId: "platform", kind: "app", workflowId: "cloud-app", apiKey: "private-workflow-key", baseUrl: "https://personal.invalid", workflowJson: { private: true } } as WorkflowRef;
    const preferences = cloudModelPreferences({ imageWorkflowRef: systemRef, videoWorkflowRef: { ...systemRef, scope: "personal" }, audioWorkflowRef: { ...systemRef, kind: "invalid" } as unknown as WorkflowRef });
    assert.deepEqual(preferences.imageWorkflowRef, { scope: "system", channelId: "platform", kind: "app", workflowId: "cloud-app" });
    assert.notEqual(preferences.imageWorkflowRef, systemRef);
    assert.equal(preferences.videoWorkflowRef, undefined);
    assert.equal(preferences.audioWorkflowRef, undefined);
    const serialized = JSON.stringify(preferences);
    assert.equal(serialized.includes("private-workflow-key"), false);
    assert.equal(serialized.includes("personal.invalid"), false);
    assert.equal(serialized.includes("workflowJson"), false);
});

test("model config sync serializes only cloud preferences even when passed an old complete config", async () => {
    const adapter = axios.defaults.adapter;
    let submitted: Record<string, unknown> | undefined;
    axios.defaults.adapter = async (request) => {
        assert.equal(request.url, "/api/v1/user-config/model");
        assert.equal(request.method, "post");
        submitted = JSON.parse(String(request.data)) as Record<string, unknown>;
        return { data: { code: 0, data: {}, msg: "" }, status: 200, statusText: "OK", headers: {}, config: request };
    };
    try {
        const stored = legacyModelConfig();
        await syncUserModelConfig("test-account-token", stored);
        assert.deepEqual(submitted, JSON.parse(JSON.stringify({ config: cloudModelPreferences(stored) })));
        const serialized = JSON.stringify(submitted);
        for (const value of ["private-model-key", "personal.invalid", "private-protocol-source", "private-cli-command", "private-workflow"]) assert.equal(serialized.includes(value), false, value);
    } finally {
        axios.defaults.adapter = adapter;
    }
});
