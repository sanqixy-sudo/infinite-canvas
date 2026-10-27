// Offline contract fixtures only. This file does not call NewAPI or NewToken.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./plugins/tasks/xiaomeng-newtoken/0.2.2/plugin.js", import.meta.url), "utf8");
const plugin = await import("data:text/javascript;base64," + Buffer.from(source).toString("base64"));
const fixture = async (name) => JSON.parse(await readFile(new URL("./fixtures/" + name + ".json", import.meta.url), "utf8"));
const request = await fixture("request");
const succeeded = await fixture("succeeded");
const missingUsage = await fixture("succeeded-missing-usage");
const context = (body = request) => ({ requestBody: body, baseUrl: "https://newtoken.example.com/", apiKey: "fixture-only", model: body.model, upstreamModel: body.model });
const totalContext = { state: { billing_mode: "total_tokens" } };
const splitContext = { state: { billing_mode: "input_output_tokens" } };
const totalFacts = (tokens) => ({ billing_mode: "total_tokens", tokens, input_tokens: 0, output_tokens: 0 });
const splitFacts = (input_tokens, output_tokens) => ({ billing_mode: "input_output_tokens", tokens: 0, input_tokens, output_tokens });

test("native route retains media order and posts only to configured NewToken origin", () => {
  const intent = plugin.native.createTask({ body: { kind: "json", value: request } });
  const outbound = plugin.buildSubmitRequest(context(intent.requestBody));
  assert.equal(outbound.url, "https://newtoken.example.com/api/v3/contents/generations/tasks");
  assert.deepEqual(outbound.body.content, request.content);
  assert.equal(outbound.body.seed, 0);
  assert.equal(plugin.meta.routes[0].path, "/xiaomeng-newtoken/api/v3/contents/generations/tasks");
});

test("submission reserves 500k without turning usage into a legacy multiplier", () => {
  assert.deepEqual(plugin.extractUsage(context()), { ...totalFacts(500000), resolution: "720p", video_input: "video" });
  assert.equal(plugin.extractUsage({ ...context(), usagePurpose: "billing_ratios" }), null);
  const plain = { ...request, content: [request.content[0]] };
  assert.equal(plugin.extractUsage(context(plain)).video_input, "none");
});

test("total_tokens is authoritative, never summed with completion_tokens", () => {
  assert.equal(plugin.parseTaskResult(totalContext, succeeded).totalTokens, 93366);
  assert.deepEqual(plugin.extractUsageOnComplete(totalContext, {}, succeeded), totalFacts(93366));
  const larger = { ...succeeded, usage: { total_tokens: 640000, completion_tokens: 610000 } };
  assert.deepEqual(plugin.extractUsageOnComplete(totalContext, {}, larger), totalFacts(640000));
});

test("missing or invalid actual usage keeps completed media pending settlement", () => {
  for (const value of [undefined, null, 0, -1, 12.5, "93366", Number.MAX_SAFE_INTEGER + 1]) {
    const body = { ...missingUsage, usage: { completion_tokens: 93366, total_tokens: value } };
    assert.equal(plugin.parseTaskResult(totalContext, body).status, "IN_PROGRESS");
    assert.throws(() => plugin.extractUsageOnComplete(totalContext, {}, body));
    const presented = plugin.native.taskStatus({}, { task_id: "public-id", status: "IN_PROGRESS", data: body });
    assert.equal(presented.status, "succeeded");
    assert.equal(presented.billing_status, "pending_usage");
    assert.equal(presented.content.video_url, body.content.video_url);
  }
});

test("native responses preserve original usage and replace private ids", () => {
  const result = plugin.native.taskStatus({}, { task_id: "public-id", status: "SUCCESS", data: succeeded });
  assert.equal(result.id, "public-id");
  assert.deepEqual(result.usage, succeeded.usage);
  assert.equal(result.billing_status, "usage_available");
  assert.equal(result["doubao-id"], undefined);
});

test("actual host timeout cannot make known successful media look failed to canvas", () => {
  const result = plugin.native.taskStatus({}, { task_id: "public-id", status: "FAILURE", fail_reason: "timeout", data: missingUsage });
  assert.equal(result.status, "succeeded");
  assert.equal(result.billing_status, "pending_usage");
});

test("unsupported parameters and fourth reference video are rejected, not truncated", () => {
  for (const patch of [{ resolution: "1080p" }, { duration: -1 }, { duration: 16 }, { draft: true }])
    assert.throws(() => plugin.buildSubmitRequest(context({ ...request, ...patch })));
  assert.throws(() => plugin.buildSubmitRequest(context({ ...request, content: [request.content[0], ...Array(4).fill(request.content[2])] })));
  assert.throws(() => plugin.buildSubmitRequest(context({ ...request, content: [request.content[0], { ...request.content[1], role: "first_frame" }, request.content[2]] })));
});

test("known failures fail, unknown statuses do not turn into success", async () => {
  assert.equal(plugin.parseTaskResult({}, await fixture("failed")).status, "FAILURE");
  assert.equal(plugin.parseTaskResult({}, { status: "unexpected" }).status, "UNKNOWN");
  assert.equal(plugin.parseSubmitResponse(context(), { body: await fixture("created") }).taskId, "ultra720_fixture_001");
});

test("all four models enforce fixed 720x1280 portrait on direct and native requests", async () => {
  assert.equal(plugin.meta.name, "newtoken 特殊渠道 · 720×1280");
  assert.equal(plugin.meta.version, "0.2.2");
  assert.equal(plugin.meta.models.length, 4);
  const full = await fixture("request-2.0-1080");
  const newest = await fixture("request-2.5");
  assert.throws(() => plugin.buildSubmitRequest(context(full)), /720p/);
  assert.equal(plugin.buildSubmitRequest(context(newest)).body.duration, 30);
  assert.equal(plugin.extractUsage(context(newest)).resolution, "720p");
  for (const model of plugin.meta.models) {
    assert.equal(plugin.buildSubmitRequest(context({ ...request, model })).body.model, model);
    assert.equal(plugin.buildSubmitRequest(context({ ...request, model, ratio: undefined })).body.ratio, "9:16");
    for (const patch of [
      ...[undefined, "480p", "1080p", "4k", "720*1280"].map((resolution) => ({ resolution })),
      ...[null, "16:9", "1:1", "21:9", "4:3", "3:4", "adaptive"].map((ratio) => ({ ratio })),
    ]) {
      const body = { ...request, model, ...patch };
      assert.throws(() => plugin.buildSubmitRequest(context(body)));
      assert.throws(() => plugin.native.createTask({ body: { kind: "json", value: body } }));
    }
  }
});

test("2.5 preserves larger reference counts and pins ordinary reference mode", async () => {
  const body = await fixture("request-2.5");
  delete body.omni_reference_task_type;
  const refs = [body.content[0], ...Array(10).fill(body.content[1])];
  const outbound = plugin.buildSubmitRequest(context({ ...body, content: refs }));
  assert.equal(outbound.body.content.length, 11);
  assert.equal(outbound.body.omni_reference_task_type, "reference");
  assert.throws(() => plugin.buildSubmitRequest(context({ ...body, content: [...refs, body.content[1]] })));
  assert.throws(() => plugin.buildSubmitRequest(context({ ...body, omni_reference_task_type: "edit" })));
});

test("2.5 permits audio-only references while 2.0 series requires visual input", async () => {
  const content = [request.content[0], { type: "audio_url", audio_url: { url: "https://media.example.com/reference.mp3" }, role: "reference_audio" }];
  const body = { ...request, model: "doubao-seedance-2-5-260628", content };
  assert.equal(plugin.buildSubmitRequest(context(body)).body.content.length, 2);
  assert.throws(() => plugin.buildSubmitRequest(context({ ...request, content })));
});

test("split mode survives task persistence and is never forwarded to NewToken", async () => {
  const intent = plugin.native.createTask({ body: { kind: "json", value: { ...request, billing_mode: "input_output_tokens" } } });
  assert.equal(intent.requestBody.billing_mode, "input_output_tokens");
  const ctx = context(intent.requestBody);
  assert.equal(Object.hasOwn(plugin.buildSubmitRequest(ctx).body, "billing_mode"), false);
  assert.equal(intent.requestBody.billing_mode, "input_output_tokens");
  assert.deepEqual(plugin.extractUsage(ctx), { ...splitFacts(250000, 250000), resolution: "720p", video_input: "video" });
  assert.deepEqual(plugin.parseSubmitResponse(ctx, { body: await fixture("created") }).state, splitContext.state);
  assert.throws(() => plugin.native.createTask({ body: { kind: "json", value: { ...request, billing_mode: "unsupported" } } }));
  assert.throws(() => plugin.parseTaskResult({}, succeeded));
});

test("split settlement accepts complete real pairs, aliases and explicit zero", () => {
  for (const usage of [
    { input_tokens: 100000, output_tokens: 200000, total_tokens: 300000 },
    { prompt_tokens: 100000, completion_tokens: 200000 },
    { input_tokens: 100000, output_tokens: 200000, prompt_tokens: 100000, completion_tokens: 200000 },
  ]) {
    const body = { ...succeeded, usage };
    assert.equal(plugin.parseTaskResult(splitContext, body).status, "SUCCESS");
    assert.deepEqual(plugin.extractUsageOnComplete(splitContext, {}, body), splitFacts(100000, 200000));
    const presented = plugin.native.taskStatus({}, { task_id: "public-id", status: "SUCCESS", data: body });
    assert.equal(presented.billing_status, "usage_available");
    assert.deepEqual(presented.usage, usage);
  }
  for (const [input, output] of [[0, 0], [0, 200000], [100000, 0]]) {
    const body = { ...succeeded, usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } };
    assert.equal(plugin.parseTaskResult(splitContext, body).status, "SUCCESS");
    assert.deepEqual(plugin.extractUsageOnComplete(splitContext, {}, body), splitFacts(input, output));
  }
});

test("split mode never estimates missing input or settles inconsistent usage", () => {
  const invalid = [
    { total_tokens: 300000 },
    { total_tokens: 300000, completion_tokens: 200000 },
    { input_tokens: 100000 },
    { input_tokens: 100000, output_tokens: 200000, prompt_tokens: 100000 },
    { input_tokens: 100000, output_tokens: 200000, total_tokens: 300001 },
    { input_tokens: 100000, output_tokens: 200000, prompt_tokens: 100001, completion_tokens: 199999 },
    { input_tokens: Number.MAX_SAFE_INTEGER, output_tokens: 1 },
    ...[null, -1, 1.5, "100000", Number.MAX_SAFE_INTEGER + 1].flatMap((value) => [
      { input_tokens: value, output_tokens: 200000 },
      { input_tokens: 100000, output_tokens: value },
      { input_tokens: 100000, output_tokens: 200000, total_tokens: value },
    ]),
  ];
  for (const usage of invalid) {
    const body = { ...succeeded, usage };
    assert.equal(plugin.parseTaskResult(splitContext, body).status, "IN_PROGRESS");
    assert.throws(() => plugin.extractUsageOnComplete(splitContext, {}, body));
    for (const status of ["IN_PROGRESS", "FAILURE"]) {
      const presented = plugin.native.taskStatus({}, { task_id: "public-id", status, data: body });
      assert.equal(presented.status, "succeeded");
      assert.equal(presented.billing_status, "pending_usage");
      assert.deepEqual(presented.usage, usage);
    }
  }
});

test("different unit prices settle only split facts and support refunds and supplements", () => {
  // Synthetic retail prices in CNY/1M; NewAPI expressions use USD after conversion.
  const cents = (facts) => Math.round((facts.input_tokens * 1035 + facts.output_tokens * 2070) / 1000000);
  const reserve = plugin.extractUsage(context({ ...request, billing_mode: "input_output_tokens" }));
  const settle = (input_tokens, output_tokens) => plugin.extractUsageOnComplete(splitContext, {}, { ...succeeded, usage: { input_tokens, output_tokens } });
  assert.equal(cents(reserve), 776);
  assert.equal(cents(settle(100000, 200000)), 518);
  assert.equal(cents(reserve) - cents(settle(100000, 200000)), 258);
  assert.equal(cents(settle(200000, 400000)) - cents(reserve), 259);
  assert.equal(settle(100000, 200000).tokens, 0);
});

test("every display example is a complete schema vector with one active billing mode", () => {
  for (const profile of [{ schema: plugin.meta.usageSchema, examples: plugin.meta.usageExamples }, ...plugin.meta.usageProfiles]) {
    // Host import constraint applies to the global list and every model profile.
    assert.ok(profile.examples.length > 0 && profile.examples.length <= 16);
    assert.deepEqual(profile.schema.resolution.enum, ["720p"]);
    for (const resolution of profile.schema.resolution.enum) {
      for (const video_input of profile.schema.video_input.enum) {
        for (const billing_mode of profile.schema.billing_mode.enum) {
          const examples = profile.examples.filter(({ facts }) => facts.resolution === resolution && facts.video_input === video_input && facts.billing_mode === billing_mode);
          assert.equal(examples.length, 2, "each price tier retains reservation and settlement previews");
        }
      }
    }
    for (const example of profile.examples) {
      assert.ok(Array.from(example.label).length <= 48);
      assert.deepEqual(Object.keys(example.facts).sort(), Object.keys(profile.schema).sort());
      for (const [key, field] of Object.entries(profile.schema)) {
        const value = example.facts[key];
        if (field.enum) assert.ok(field.enum.includes(value));
        else assert.ok(Number.isFinite(value) && value >= 0);
      }
      if (example.facts.billing_mode === "total_tokens") {
        assert.equal(example.facts.input_tokens + example.facts.output_tokens, 0);
      } else assert.equal(example.facts.tokens, 0);
    }
  }
});
