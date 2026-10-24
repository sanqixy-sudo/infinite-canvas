import assert from "node:assert/strict";
import test from "node:test";

import type { AdminPublicSettings } from "@/services/api/admin";
import { defaultConfig, resolveEffectiveConfig, resolveModelForCapability, type AiConfig } from "./use-config-store";

const modelChannel: AdminPublicSettings["modelChannel"] = {
    availableModels: ["studio-image", "retired-image"],
    availableWorkflows: [],
    modelCosts: [],
    channels: [
        { id: "platform", protocol: "openai", name: "平台模型", baseUrl: "", models: ["studio-image"], modelCapabilities: { "studio-image": "image" }, weight: 1, timeout: 600, enabled: true, remark: "" },
        { id: "disabled", protocol: "openai", name: "已停用", baseUrl: "", models: ["retired-image"], weight: 1, timeout: 600, enabled: false, remark: "" },
        { id: "workflow", protocol: "runninghub", name: "平台工作流", baseUrl: "", models: [], weight: 1, timeout: 600, enabled: true, remark: "", workflows: [{ provider: "runninghub", kind: "workflow", workflowId: "cloud-image", title: "云端生图", capability: "image", enabled: true }] },
    ],
    defaultModel: "",
    defaultImageModel: "studio-image",
    defaultVideoModel: "",
    defaultTextModel: "",
    systemPrompt: "",
    systemPrompts: defaultConfig.systemPrompts,
    allowCustomChannel: true,
    allowUserRemoteChannel: true,
};

function storedConfig(): AiConfig {
    return {
        ...defaultConfig,
        channelMode: "local",
        baseUrl: "https://personal.invalid",
        apiKey: "saved-private-value",
        imageModel: "personal-image",
        models: ["personal-image"],
        localChannels: [{ id: "personal", protocol: "openai", name: "旧个人渠道", baseUrl: "https://personal.invalid", apiKey: "saved-private-value", models: ["personal-image"] }],
        imageWorkflowRef: { scope: "personal", channelId: "personal", kind: "workflow", workflowId: "private-image" },
    };
}

test("effective creation config uses only enabled platform models without overwriting saved personal settings", () => {
    const stored = storedConfig();
    const before = structuredClone(stored);
    const effective = resolveEffectiveConfig(stored, modelChannel, true);
    assert.equal(effective.channelMode, "remote");
    assert.equal(effective.baseUrl, "");
    assert.equal(effective.apiKey, "");
    assert.deepEqual(effective.localChannels, []);
    assert.deepEqual(effective.models, ["studio-image"]);
    assert.equal(effective.imageModel, "studio-image");
    assert.equal(effective.videoModel, "");
    assert.equal(effective.imageWorkflowRef, undefined);
    assert.deepEqual(stored, before);
});

test("unavailable cloud access leaves empty remote selections instead of reverting to local examples", () => {
    for (const [settings, allowed] of [[null, true], [modelChannel, false]] as const) {
        const effective = resolveEffectiveConfig(storedConfig(), settings, allowed);
        assert.equal(effective.channelMode, "remote");
        assert.deepEqual(effective.models, []);
        assert.deepEqual(effective.publicChannels, []);
        assert.equal(effective.imageModel, "");
        assert.equal(resolveModelForCapability(effective, "gpt-image-2", "image"), "");
        assert.equal(resolveModelForCapability(effective, "grok-imagine-video", "video"), "");
    }
});

test("only enabled system workflow defaults survive cloud config resolution", () => {
    const ref = { scope: "system", channelId: "workflow", kind: "workflow", workflowId: "cloud-image" } as const;
    assert.deepEqual(resolveEffectiveConfig({ ...storedConfig(), imageWorkflowRef: ref }, modelChannel, true).imageWorkflowRef, ref);
    assert.equal(resolveEffectiveConfig({ ...storedConfig(), imageWorkflowRef: { ...ref, workflowId: "missing" } }, modelChannel, true).imageWorkflowRef, undefined);
    assert.equal(resolveEffectiveConfig({ ...storedConfig(), imageWorkflowRef: ref }, modelChannel, false).imageWorkflowRef, undefined);
});
