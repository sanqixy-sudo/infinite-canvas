import assert from "node:assert/strict";
import test from "node:test";
import { modelCreditCost, requestCreditCost } from "./credits";

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
