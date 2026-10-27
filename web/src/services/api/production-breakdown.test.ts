import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import { productionBreakdownPrice } from "./production-breakdown";

const config = (): AiConfig => ({ ...defaultConfig, channelMode: "remote", model: "text-model", textModel: "text-model", models: ["text-model", "video-model"], publicChannels: [{ id: "cloud", protocol: "openai", enabled: true, models: ["text-model", "video-model"], modelCapabilities: { "text-model": "text", "video-model": "video" } }] });

test("拆镜只允许平台文字模型和明确的有限非负按次价", () => {
    assert.equal(productionBreakdownPrice(config(), [{ model: "text-model", credits: 2.5 }]), 2.5);
    assert.equal(productionBreakdownPrice(config(), [{ model: "text-model", credits: 0 }]), 0);
    assert.throws(() => productionBreakdownPrice({ ...config(), channelMode: "local" }, [{ model: "text-model", credits: 1 }]), /平台/u);
    assert.throws(() => productionBreakdownPrice({ ...config(), textModel: "video-model" }, [{ model: "video-model", credits: 1 }]), /文字模型/u);
    assert.throws(() => productionBreakdownPrice(config(), []), /价格/u);
    for (const credits of [-1, Infinity, NaN]) assert.throws(() => productionBreakdownPrice(config(), [{ model: "text-model", credits }]), /价格/u);
    assert.throws(() => productionBreakdownPrice(config(), [{ model: "text-model", credits: 1, billingUnit: "token" }]), /按次/u);
});
