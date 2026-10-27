import assert from "node:assert/strict";
import test from "node:test";
import { gatewayCountError, gatewayInputError, gatewayVariants, resolveGatewayVariant, type PublishedGatewayModel } from "./model-gateway";
import { gatewayQuoteMatches, requestCreditCost, type TokenQuote } from "@/constant/credits";

const caps = { resolutions: ["720p"], ratios: ["9:16"], minDuration: 4, maxDuration: 15, maxImages: 9, maxVideos: 1, maxAudios: 3, maxTotal: 0, firstFrame: false, lastFrame: false, audioOnly: false };
const pricing = { unit: "second" as const, quantitySource: "request_duration" as const, currency: "CNY" as const, per: 1, tokenMode: "" as const, reserveTokens: 0, reserveInputTokens: 0, reserveOutputTokens: 0, withoutVideoCents: 30, withVideoCents: 50, tiers: [{ resolution: "720p", withoutVideoCents: 30, withVideoCents: 50 }] };
const sale = { unit: "second" as const, tokenMode: "" as const, reserveTokens: 0, reserveInputTokens: 0, reserveOutputTokens: 0, withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, withoutVideoCredits: 3, withVideoCredits: 5 }] };
const model: PublishedGatewayModel = { id: "model", name: "标准模型", group: "特价", revision: "r1", displayName: "", badge: "", remark: "", capabilities: { ...caps, resolutions: ["720p", "1080p"], ratios: ["9:16", "16:9"], maxVideos: 3 }, pricing, sale: { ...sale, unit: "variants", variants: [{ id: "portrait", sale }, { id: "landscape", sale: { ...sale, tiers: sale.tiers.map((tier) => ({ ...tier, resolution: "1080p", withoutVideoCredits: 6 })) } }], tiers: [] }, variants: [{ id: "portrait", name: "竖屏", capabilities: caps, pricing }, { id: "landscape", name: "横屏", capabilities: { ...caps, resolutions: ["1080p"], ratios: ["16:9"], maxVideos: 3 }, pricing: { ...pricing, tiers: [{ resolution: "1080p", withoutVideoCents: 60, withVideoCents: 70 }] } }] };
const parameters = { resolution: "720p", ratio: "9:16", duration: 5, generateAudio: true, watermark: false };

test("规格联动不会组合出不支持的比例，连线按当前规格限制", () => {
    assert.equal(resolveGatewayVariant(model, parameters, [])?.id, "portrait");
    assert.throws(() => resolveGatewayVariant(model, { ...parameters, ratio: "16:9" }, []));
    assert.deepEqual(gatewayVariants(model, { resolution: "1080p" }).flatMap((v) => v.capabilities.ratios), ["16:9"]);
    const videos = [{ kind: "video" as const, role: "reference_video" as const }, { kind: "video" as const, role: "reference_video" as const }];
    assert.match(gatewayCountError(model, videos, parameters), /1 段视频/);
    assert.equal(gatewayInputError(model, videos, { ...parameters, resolution: "1080p", ratio: "16:9" }), "");
});

test("按秒规格预扣金额和报价同时匹配规格、单价及数量", () => {
    const options = { channelMode: "remote", model: "model", modelCosts: [{ model: "model", credits: 0, gateway: model }], seconds: 5, resolution: "720p", ratio: "9:16", referenceMode: "text" as const, hasReferenceVideo: false };
    assert.equal(requestCreditCost(options), 15);
    assert.equal(requestCreditCost({ ...options, hasReferenceVideo: true }), 25);
    assert.equal(requestCreditCost({ ...options, ratio: "16:9" }), null);
    const quote: TokenQuote = { unit: "second", variantId: "portrait", quantitySource: "request_duration", reserveUnits: 5, unitPriceCredits: 3, reserveCredits: 15, tokenMode: "", reserveTokens: 0, reserveInputTokens: 0, reserveOutputTokens: 0, unitPriceCreditsPerMillion: 3, inputPriceCreditsPerMillion: 0, outputPriceCreditsPerMillion: 0 };
    assert.equal(gatewayQuoteMatches(quote, model, parameters, "portrait", false), true);
    assert.equal(gatewayQuoteMatches({ ...quote, variantId: "landscape" }, model, parameters, "portrait", false), false);
    assert.equal(gatewayQuoteMatches({ ...quote, reserveUnits: 3, unitPriceCredits: 5 }, model, parameters, "portrait", false), false);
    assert.equal(gatewayQuoteMatches({ ...quote, quantitySource: "response_duration" }, model, parameters, "portrait", false), false);
});

test("参考场景和音频条件可单独决定规格", () => {
    const conditional = { ...model, variants: [{ ...model.variants![0], referenceModes: ["text" as const], generateAudio: false }, { ...model.variants![0], id: "video", referenceModes: ["video" as const], generateAudio: true }] };
    assert.throws(() => resolveGatewayVariant(conditional, parameters, []));
    assert.equal(resolveGatewayVariant(conditional, { ...parameters, generateAudio: false }, [])?.id, "portrait");
    assert.equal(resolveGatewayVariant(conditional, parameters, [{ kind: "video" }])?.id, "video");
});
