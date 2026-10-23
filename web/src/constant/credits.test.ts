import assert from "node:assert/strict";
import test from "node:test";
import { modelCreditCost, requestCreditCost, tokenQuoteMatches, type ModelCreditCost, type TokenQuote } from "./credits";

test("未定价不能显示免费，显式零价和自有渠道可正常使用", () => {
    const costs = [{ model: "free-model", credits: 0 }];
    assert.equal(modelCreditCost(costs, "missing-model"), null);
    assert.equal(requestCreditCost({ channelMode: "remote", modelCosts: costs, model: "missing-model" }), null);
    assert.equal(requestCreditCost({ channelMode: "remote", modelCosts: costs, model: "free-model" }), 0);
    assert.equal(requestCreditCost({ channelMode: "local", model: "my-model" }), 0);
});

test("视频估价按后端规则向上取整，自动时长采用十五秒", () => {
    const options = { channelMode: "remote", model: "video-model", modelCosts: [{ model: "video-model", credits: 2.5 }] };
    assert.equal(requestCreditCost({ ...options, seconds: 5.2 }), 15);
    assert.equal(requestCreditCost({ ...options, seconds: "5.2s" }), 15);
    assert.equal(requestCreditCost({ ...options, seconds: -1 }), 37.5);
    assert.equal(requestCreditCost({ ...options, seconds: -5 }), null);
});

test("Token 模型按分辨率及参考视频预扣，不再乘视频秒数", () => {
    const modelCosts = [{ model: "seedance", credits: 0, billingUnit: "token" as const, tokenMode: "total_tokens" as const, reserveTokens: 500_000, reserveCredits: 38.5, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 70, withVideoCreditsPerMillion: 42 }, { resolution: "1080p", withoutVideoCreditsPerMillion: 77, withVideoCreditsPerMillion: 46 }] }];
    const request = { channelMode: "remote", model: "seedance", modelCosts, seconds: 15 };
    assert.equal(requestCreditCost({ ...request, resolution: "720", hasReferenceVideo: false }), 35);
    assert.equal(requestCreditCost({ ...request, resolution: "720p", hasReferenceVideo: true }), 21);
    assert.equal(requestCreditCost({ ...request, resolution: "1080p", hasReferenceVideo: true }), 23);
    assert.equal(requestCreditCost({ ...request, resolution: "1080p" }), 38.5);
    assert.equal(requestCreditCost(request), 38.5);
    assert.equal(requestCreditCost({ ...request, resolution: "480p", hasReferenceVideo: false }), null);
});

test("Token 模型缺少可靠预扣金额不能显示免费", () => {
    assert.equal(requestCreditCost({ channelMode: "remote", model: "token", modelCosts: [{ model: "token", credits: 0, billingUnit: "token" }] }), null);
});

test("Token 模型缺少明确计费模式时不估价也不接受报价", () => {
    const cost: ModelCreditCost = { model: "token", credits: 0, billingUnit: "token", reserveTokens: 500_000, reserveCredits: 5, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 10, withVideoCreditsPerMillion: 10 }] };
    const quote = { tokenMode: undefined, reserveCredits: 5, unitPriceCreditsPerMillion: 10, reserveTokens: 500_000, inputPriceCreditsPerMillion: 0, outputPriceCreditsPerMillion: 0, reserveInputTokens: 0, reserveOutputTokens: 0 } as unknown as TokenQuote;
    assert.equal(requestCreditCost({ channelMode: "remote", model: "token", modelCosts: [cost], resolution: "720p" }), null);
    assert.equal(tokenQuoteMatches(quote, cost, "720p", false), false);
});

test("输入输出分别计价，按分辨率和参考场景合计预扣", () => {
    const modelCosts: ModelCreditCost[] = [{ model: "split", credits: 0, billingUnit: "token", tokenMode: "input_output_tokens", reserveInputTokens: 100_000, reserveOutputTokens: 400_000, tiers: [
        { resolution: "720p", withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, withoutVideoInputCreditsPerMillion: 7, withoutVideoOutputCreditsPerMillion: 37, withVideoInputCreditsPerMillion: 20, withVideoOutputCreditsPerMillion: 30 },
        { resolution: "1080p", withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, withoutVideoInputCreditsPerMillion: 11, withoutVideoOutputCreditsPerMillion: 53, withVideoInputCreditsPerMillion: 24, withVideoOutputCreditsPerMillion: 42 },
    ] }];
    const request = { channelMode: "remote", model: "split", modelCosts, seconds: 15 };
    assert.equal(requestCreditCost({ ...request, resolution: "720p", hasReferenceVideo: false }), 15.5);
    assert.equal(requestCreditCost({ ...request, resolution: "720p", hasReferenceVideo: true }), 14);
    // 不确定引用场景时比较每个场景的合计，不拼出不存在的最高输入价 + 最高输出价。
    assert.equal(requestCreditCost({ ...request, resolution: "720p" }), 15.5);
    assert.equal(requestCreditCost({ ...request, resolution: "1080p", hasReferenceVideo: true }), 19.2);
    assert.equal(requestCreditCost(request), 22.3);
    assert.equal(requestCreditCost({ ...request, resolution: "480p" }), null);
});

test("分项预扣允许一个分项为零，缺失价格或预扣数不按零处理", () => {
    const cost: ModelCreditCost = { model: "split", credits: 0, billingUnit: "token", tokenMode: "input_output_tokens", reserveInputTokens: 0, reserveOutputTokens: 500_000, reserveCredits: 99, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 99, withVideoCreditsPerMillion: 99, withoutVideoInputCreditsPerMillion: 7, withoutVideoOutputCreditsPerMillion: 37, withVideoInputCreditsPerMillion: 20, withVideoOutputCreditsPerMillion: 30 }] };
    const request = { channelMode: "remote", model: "split", resolution: "720p", hasReferenceVideo: false };
    assert.equal(requestCreditCost({ ...request, modelCosts: [cost] }), 18.5);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ ...cost, reserveInputTokens: undefined }] }), null);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ ...cost, reserveOutputTokens: 0 }] }), null);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ ...cost, tiers: [{ ...cost.tiers![0], withoutVideoOutputCreditsPerMillion: undefined }] }] }), null);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ ...cost, tiers: [{ ...cost.tiers![0], withoutVideoInputCreditsPerMillion: 0 }] }] }), null);
});

test("预扣合计后按0.01四舍五入，分项不各自舍入", () => {
    const request = { channelMode: "remote", model: "split", resolution: "720p", hasReferenceVideo: false };
    const cost: ModelCreditCost = { model: "split", credits: 0, billingUnit: "token", tokenMode: "input_output_tokens", reserveInputTokens: 1_000, reserveOutputTokens: 1_000, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, withoutVideoInputCreditsPerMillion: 6, withoutVideoOutputCreditsPerMillion: 6 }] };
    assert.equal(requestCreditCost({ ...request, modelCosts: [cost] }), 0.01);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ ...cost, reserveInputTokens: 0, reserveOutputTokens: 1_000, tiers: [{ ...cost.tiers![0], withoutVideoOutputCreditsPerMillion: 5 }] }] }), 0.01);
    assert.equal(requestCreditCost({ ...request, modelCosts: [{ model: "split", credits: 0, billingUnit: "token", tokenMode: "total_tokens", reserveTokens: 500_000, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 1.222, withVideoCreditsPerMillion: 1.222 }] }] }), 0.61);
});

test("预扣金额相同时仍拒绝计费模式、分项费率或预扣数被更换", () => {
    const cost: ModelCreditCost = { model: "split", credits: 0, billingUnit: "token", tokenMode: "input_output_tokens", reserveInputTokens: 100_000, reserveOutputTokens: 400_000, tiers: [{ resolution: "720p", withoutVideoCreditsPerMillion: 0, withVideoCreditsPerMillion: 0, withoutVideoInputCreditsPerMillion: 10, withoutVideoOutputCreditsPerMillion: 20 }] };
    const quote: TokenQuote = { tokenMode: "input_output_tokens", reserveCredits: 9, unitPriceCreditsPerMillion: 0, reserveTokens: 0, inputPriceCreditsPerMillion: 10, outputPriceCreditsPerMillion: 20, reserveInputTokens: 100_000, reserveOutputTokens: 400_000 };
    assert.equal(tokenQuoteMatches(quote, cost, "720p", false), true);
    assert.equal(tokenQuoteMatches({ ...quote, inputPriceCreditsPerMillion: 14, outputPriceCreditsPerMillion: 19 }, cost, "720p", false), false);
    assert.equal(tokenQuoteMatches({ ...quote, reserveInputTokens: 50_000, reserveOutputTokens: 425_000 }, cost, "720p", false), false);
    assert.equal(tokenQuoteMatches({ ...quote, tokenMode: "total_tokens", unitPriceCreditsPerMillion: 18, reserveTokens: 500_000 }, cost, "720p", false), false);
    assert.equal(tokenQuoteMatches({ ...quote, reserveCredits: NaN }, cost, "720p", false), false);
    assert.equal(tokenQuoteMatches({ ...quote, reserveCredits: 9.02 }, cost, "720p", false), false);
    assert.equal(tokenQuoteMatches(quote, cost, "1080p", false), false);
});
