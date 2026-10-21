import assert from "node:assert/strict";
import test from "node:test";
import type { AdminPublicSettings } from "@/services/api/admin";
import { platformModelCatalogue } from "./platform-model-catalogue";

test("平台清单仅发布有显式价格的公开模型，保留免费模型并隐藏停用或未定价项", () => {
    const settings = {
        modelChannel: {
            availableModels: ["image-model", "unpriced", "disabled"],
            availableWorkflows: ["workflow:system:workflow-channel:workflow:123", "workflow:system:disabled-workflow-channel:workflow:456"],
            modelCosts: [{ model: "image-model", credits: 0 }, { model: "hidden", credits: 2 }, { model: "disabled", credits: 3 }, { model: "workflow:system:workflow-channel:workflow:123", credits: 8 }, { model: "workflow:system:disabled-workflow-channel:workflow:456", credits: 9 }],
            channels: [
                { id: "channel", enabled: true, name: "平台渠道", protocol: "openai", baseUrl: "must-not-display", models: ["image-model", "hidden", "unpriced"], modelCapabilities: { "image-model": "image" } },
                { id: "disabled-channel", enabled: false, protocol: "openai", models: ["disabled"] },
                { id: "workflow-channel", enabled: true, protocol: "runninghub", models: [], workflows: [{ enabled: true, provider: "runninghub", kind: "workflow", workflowId: "123", title: "视频工作流", capability: "video" }] },
                { id: "disabled-workflow-channel", enabled: false, protocol: "runninghub", models: [], workflows: [{ enabled: true, provider: "runninghub", kind: "workflow", workflowId: "456", title: "停用渠道的公开工作流", capability: "video" }] },
            ],
        },
    } as AdminPublicSettings;
    const result = platformModelCatalogue(settings);
    assert.deepEqual(result.map((item) => [item.name, item.credits, item.unit]), [["image-model", 0, "张"], ["视频工作流", 8, "次"]]);
    assert.equal(JSON.stringify(result).includes("must-not-display"), false);
    assert.deepEqual(platformModelCatalogue(null), []);
});
