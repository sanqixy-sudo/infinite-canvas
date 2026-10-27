import assert from "node:assert/strict";
import test from "node:test";
import { defaultConfig, type AiConfig } from "@/stores/use-config-store";
import type { CanvasProject } from "../stores/use-canvas-store";
import { normalizeWorkspaceSettings, projectDefaultModelWarnings, resolveProjectDefaultModel, resolveWorkspaceCover, workspaceCoverCandidates } from "./workspace-settings";
import { importCanvasProjectGroups, remapCanvasBundle } from "./canvas-transfer";

function fixture() {
    const projects = [
        { id: "root", nodes: [], connections: [], workspaceSettings: { defaultModels: { video: { model: "portrait", channelId: "fixed" } }, cover: { canvasId: "child", nodeId: "image" } } },
        { id: "child", workspaceId: "root", nodes: [{ id: "image", type: "image", title: "镜头候选", position: { x: 0, y: 0 }, metadata: { content: "blob:reference", storageKey: "image:original" } }, { id: "existing", type: "video", title: "在途任务", position: { x: 0, y: 0 }, metadata: { model: "original", channelId: "original-channel", status: "loading", videoTaskId: "paid-job" } }], connections: [] },
        { id: "foreign", nodes: [{ id: "private-image", type: "image", metadata: { storageKey: "server:private-file" } }], connections: [] },
    ] as unknown as CanvasProject[];
    const config: AiConfig = { ...defaultConfig, models: ["portrait"], publicChannels: [{ id: "fixed", protocol: "gateway", enabled: true, models: ["portrait"], modelCapabilities: { portrait: "video" } }, { id: "another", protocol: "gateway", models: ["portrait"], modelCapabilities: { portrait: "video" } }] };
    return { projects, config };
}

test("项目默认严格匹配平台模型、渠道与能力；停用不换到同名渠道，已有节点和任务不改变", () => {
    const { projects, config } = fixture();
    const before = structuredClone({ projects, config });
    assert.deepEqual(resolveProjectDefaultModel(projects, "child", config, "video"), { model: "portrait", channelId: "fixed" });
    assert.equal(resolveProjectDefaultModel(projects, "child", config, "image"), undefined);
    assert.equal(resolveProjectDefaultModel(projects, "foreign", config, "video"), undefined);
    assert.equal(resolveProjectDefaultModel(projects, "missing", config, "video"), undefined);
    assert.equal(resolveProjectDefaultModel(projects, "root", { ...config, channelMode: "local" }, "video"), undefined);
    const disabled = { ...config, publicChannels: config.publicChannels.map((channel) => ({ ...channel, enabled: channel.id !== "fixed" })) };
    assert.equal(resolveProjectDefaultModel(projects, "child", disabled, "video"), undefined, "不能悄悄切换到同名另一计价渠道");
    assert.match(projectDefaultModelWarnings(projects, "child", disabled)[0], /视频默认模型.*不可用/);
    assert.equal(resolveProjectDefaultModel(projects, "child", { ...config, models: [] }, "video"), undefined);
    assert.deepEqual({ projects, config }, before, "读取默认值不修改旧节点、在途任务或固定分辨率能力");
});

test("封面只引用本项目真实图片；删除、空节点、视频和其他项目引用安全失效", () => {
    const { projects } = fixture();
    assert.equal(workspaceCoverCandidates(projects, "root").length, 1);
    assert.equal(resolveWorkspaceCover(projects, "root")?.node.id, "image");
    assert.equal(resolveWorkspaceCover(projects, "root", { canvasId: "foreign", nodeId: "private-image" }), undefined);
    assert.equal(resolveWorkspaceCover(projects, "root", { canvasId: "child", nodeId: "existing" }), undefined);
    projects[1].nodes = projects[1].nodes.filter((node) => node.id !== "image");
    assert.equal(resolveWorkspaceCover(projects, "root"), undefined, "旧引用失效后可回到自动预览，不复制或读取其他项目文件");
});

test("完整项目导入同时重映射封面的画布与节点，保留默认选择且不携带凭据", () => {
    const { projects } = fixture();
    const source = projects.slice(0, 2);
    const before = structuredClone(source);
    const bundle = remapCanvasBundle(source, []);
    const importedImage = bundle.projects[1].nodes.find((node) => node.type === "image")!;
    assert.notEqual(importedImage.id, "image");
    assert.equal(bundle.projects[0].workspaceSettings?.cover?.nodeId, importedImage.id);
    const settings: unknown[] = [];
    importCanvasProjectGroups(bundle.projects, (project) => `new-${project.id}`, (id, value) => settings.push({ id, value }));
    assert.deepEqual(settings, [{ id: "new-root", value: { defaultModels: { video: { model: "portrait", channelId: "fixed" } }, cover: { canvasId: "new-child", nodeId: importedImage.id } } }]);
    assert.equal(importedImage.metadata?.storageKey, "image:original");
    assert.equal(remapCanvasBundle([source[0]], []).projects[0].workspaceSettings?.cover, undefined, "不完整封面引用回退自动模式");
    assert.deepEqual(source, before);
    const untrusted = { defaultModels: { video: { model: "portrait", channelId: "fixed", apiKey: "secret" } }, cover: { canvasId: "child", nodeId: "image", url: "private-url" }, baseUrl: "private-base" };
    assert.equal(JSON.stringify(normalizeWorkspaceSettings(untrusted)).includes("private"), false);
    assert.equal(JSON.stringify(normalizeWorkspaceSettings(untrusted)).includes("secret"), false);
});
