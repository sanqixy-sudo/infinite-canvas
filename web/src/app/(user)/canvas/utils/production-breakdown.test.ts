import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionDocument, ProductionShot } from "../lib/production-types";
import { appendProductionBreakdown, parseProductionBreakdown, productionBreakdownPrompt, productionBreakdownSource, validateProductionBreakdownShots } from "./production-breakdown";

const document = (): ProductionDocument => ({ id: "plan", workspaceId: "workspace", title: "雨夜", synopsis: "重逢", styleGuide: "自然光", revision: 1, createdAt: "now", updatedAt: "now", episodes: [{ id: "episode", title: "第一集", script: "女孩走进雨夜，轻声说：我回来了。", order: 0 }, { id: "other", title: "第二集", script: "其他剧本", order: 1 }], scenes: [{ id: "scene", episodeId: "episode", title: "门口", description: "夜、外景", order: 0 }, { id: "other-scene", episodeId: "other", title: "屋内", description: "", order: 0 }], assets: [{ id: "character", kind: "character", title: "女主", description: "黑发短发", variantOf: "", references: [{ canvasId: "private-canvas", nodeId: "private-node" }] }], shots: [] });
const row = () => ({ title: "雨中归来", sceneId: "scene", description: "女孩来到门口", dialogue: "我回来了。", camera: "中景，缓慢推进", seconds: 5, assetIds: ["character"] });
const parse = (value: unknown, doc = document(), count = 12) => parseProductionBreakdown(JSON.stringify(value), doc, "episode", productionBreakdownSource(doc, "episode"), count);

test("拆镜仅提交当前分集和文字设定，不提交其他剧本或文件引用", () => {
    const prompt = productionBreakdownPrompt(document(), "episode", 12, "保留对白");
    assert.match(prompt.user, /女孩走进雨夜/u);
    assert.match(prompt.user, /黑发短发/u);
    assert.doesNotMatch(prompt.user, /其他剧本|private-canvas|private-node|other-scene/u);
    assert.match(prompt.system, /不提交图片或视频生成/u);
    assert.throws(() => productionBreakdownPrompt(document(), "missing", 5, ""), /分集/u);
    assert.throws(() => productionBreakdownPrompt(document(), "episode", 41, ""), /1–40/u);
    assert.throws(() => productionBreakdownPrompt(document(), "episode", 1.5, ""), /1–40/u);
    assert.throws(() => productionBreakdownPrompt(document(), "episode", 10, "a".repeat(2001)), /2000/u);
    const long = document(); long.episodes[0].script = "a".repeat(140001);
    assert.throws(() => productionBreakdownPrompt(long, "episode", 10, ""), /未提交/u);
});

test("拒绝工具、节点、费用、额外字段和未完成JSON，不自动执行或修复", () => {
    for (const value of [{ shots: [row()], actions: [] }, { shots: [{ ...row(), canvasId: "foreign" }] }, { shots: [{ ...row(), credits: 0 }] }, { actions: [{ name: "generate_video" }] }, [], null]) assert.throws(() => parse(value));
    assert.throws(() => parseProductionBreakdown('{"shots":[', document(), "episode", "", 12), /完整 JSON/u);
    assert.throws(() => parseProductionBreakdown("a".repeat(500001), document(), "episode", "", 12), /过长/u);
    assert.throws(() => parse({ shots: [{ ...row(), title: { injected: true } }] }), /标题/u);
    assert.throws(() => parse({ shots: [{ ...row(), title: "" }] }), /标题/u);
    const fenced = parseProductionBreakdown("```json\n" + JSON.stringify({ shots: [row()] }) + "\n```", document(), "episode", productionBreakdownSource(document(), "episode"), 12);
    assert.equal(fenced.shots.length, 1);
});

test("限制计划时长、镜头数和本项目资产/本集场次引用", () => {
    for (const seconds of [0, -1, 1.2, 61, "5", null]) assert.throws(() => parse({ shots: [{ ...row(), seconds }] }), /时长/u);
    assert.throws(() => parse({ shots: Array(41).fill(row()) }), /1–40/u);
    assert.throws(() => parse({ shots: [row(), row()] }, document(), 1), /选择上限/u);
    assert.throws(() => parse({ shots: [{ ...row(), sceneId: "other-scene" }] }), /场次/u);
    assert.throws(() => parse({ shots: [{ ...row(), assetIds: ["foreign"] }] }), /资产/u);
    assert.throws(() => parse({ shots: [{ ...row(), assetIds: ["character", "character"] }] }), /资产/u);
    assert.equal(parse({ shots: [{ ...row(), sceneId: "", assetIds: [] }] }).shots.length, 1);
});

test("按审阅顺序追加，保留已有镜头，稳定标识阻止重复采用", () => {
    const doc = document();
    const existing: ProductionShot = { ...row(), id: "existing", episodeId: "episode", order: 8, canvasId: "canvas", textNodeId: "text", imageNodeId: "image", videoNodeId: "video", status: "ready", candidates: [], selectedImageCandidateId: "", selectedVideoCandidateId: "" };
    doc.shots = [existing];
    const draft = parse({ shots: [row(), { ...row(), title: "开门" }] }, doc);
    const result = appendProductionBreakdown(doc, draft);
    assert.equal(result.shots[0], existing);
    assert.equal(doc.shots.length, 1);
    assert.deepEqual(result.shots.slice(1).map((shot) => shot.order), [9, 10]);
    assert.deepEqual(result.shots.slice(1).map((shot) => shot.id), draft.shotIds);
    for (const shot of result.shots.slice(1)) {
        assert.equal(shot.status, "draft");
        assert.equal(shot.canvasId, "");
        assert.equal(shot.videoNodeId, "");
        assert.deepEqual(shot.candidates, []);
    }
    assert.throws(() => appendProductionBreakdown(result, draft), /重复追加/u);
});

test("追加前对剧本、资产、项目、数量重新校验，不拿旧上下文覆盖新编辑", () => {
    const doc = document(), draft = parse({ shots: [row()] }, doc);
    for (const changed of [{ ...doc, id: "other-plan" }, { ...doc, workspaceId: "other-workspace" }, { ...doc, styleGuide: "新风格" }, { ...doc, episodes: doc.episodes.map((episode) => ({ ...episode, script: "新剧本" })) }, { ...doc, assets: doc.assets.map((asset) => ({ ...asset, description: "长发" })) }]) assert.throws(() => appendProductionBreakdown(changed, draft), /已变化/u);
    const full = appendProductionBreakdown(doc, draft); full.shots = Array.from({ length: 500 }, (_, index) => ({ ...full.shots[0], id: `old-${index}` }));
    assert.throws(() => appendProductionBreakdown(full, draft), /500/u);
    assert.throws(() => appendProductionBreakdown(doc, { ...draft, shotIds: [] }), /标识/u);
    const invalid = { ...row(), title: "", description: "" };
    assert.equal(validateProductionBreakdownShots([invalid], true)[0].title, "", "浏览器保留尚未完成的人工编辑");
    assert.throws(() => validateProductionBreakdownShots([invalid]), /标题/u);
});
