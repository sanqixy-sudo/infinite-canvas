import assert from "node:assert/strict";
import test from "node:test";
import { createZip, readZip } from "@/lib/zip";
import type { CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { bindImportedProduction, buildCanvasArchive, importCanvasProjectGroups, prepareCanvasImport, prepareCanvasBundleImport, remapCanvasBundle, remapProductionCanvases } from "./canvas-transfer";
import type { ProductionDocument } from "../lib/production-types";

const imageKey = "server:image-old";
const imageUrl = "/api/files/image-old/content?access=old";
const audioKey = "server:audio-old";
const audioUrl = "https://storage.example.test/audio.mp3";

function projects() {
    return [
        { id: "root", title: "画布 1", workspaceTitle: "项目", connections: [], nodes: [{ id: "image", title: "参考图", type: "image", position: {x:0,y:0}, metadata: { storageKey: imageKey, content: imageUrl } }], references: [imageUrl] },
        { id: "child", workspaceId: "root", title: "画布 2", connections: [], nodes: [{ id: "audio", title: "配音", type: "audio", position: {x:0,y:0}, metadata: { storageKey: audioKey, content: audioUrl, imageStorage: [{ storageKey: imageKey, url: imageUrl }] } }] },
    ] as unknown as CanvasProject[];
}

function pendingProduction(): ProductionDocument {
    return { id: "", workspaceId: "root", title: "导入计划", synopsis: "保留剧情", styleGuide: "", revision: 0, createdAt: "", updatedAt: "", episodes: [{ id: "episode", title: "第一集", script: "不能丢失的剧本", order: 0 }], scenes: [], assets: [], shots: [] };
}

test("导出前拒绝缺失节点、其他项目引用和遗漏根项目，不下载素材或生成不可恢复备份", async () => {
    const canvases = projects();
    const doc = pendingProduction();
    doc.assets = [{ id: "actor", kind: "character", title: "角色", description: "", variantOf: "", references: [{ canvasId: "root", nodeId: "deleted-image" }] }];
    let reads = 0;
    const readFile = async () => { reads++; return new Blob(["media"]); };
    await assert.rejects(buildCanvasArchive(canvases, readFile, [doc]), /画布或节点缺失/);
    const other = { ...canvases[0], id: "other" };
    doc.assets[0].references = [{ canvasId: "other", nodeId: "image" }];
    await assert.rejects(buildCanvasArchive([...canvases, other], readFile, [doc]), /不属于本项目/);
    await assert.rejects(buildCanvasArchive([canvases[1]], readFile, [doc]), /所属项目不在导出包/);
    assert.equal(reads, 0, "无效计划在读取任何素材前被拒绝");
    assert.equal(doc.episodes[0].script, "不能丢失的剧本");
});

test("导入草稿恢复只绑定同项目空版本1，已有编辑或其他项目不能被导入覆盖", () => {
    const pending = pendingProduction();
    const original = structuredClone(pending);
    const created = { ...pending, id: "created-plan", revision: 1, createdAt: "created", updatedAt: "created", episodes: [] };
    const restored = bindImportedProduction(pending, created);
    assert.equal(restored.id, "created-plan");
    assert.equal(restored.revision, 1);
    assert.deepEqual(restored.episodes, pending.episodes);
    assert.equal(bindImportedProduction(pending, created).id, restored.id, "创建响应丢失后可绑定同一幂等计划");
    for (const occupied of [{ ...created, workspaceId: "another-user-project" }, { ...created, revision: 2 }, { ...created, episodes: pending.episodes }]) {
        assert.throws(() => bindImportedProduction(pending, occupied), /草稿仍保留/);
    }
    assert.throws(() => bindImportedProduction(restored, created), /草稿仍保留/, "已绑定的草稿继续使用原ID和CAS版本，不能重新创建");
    assert.deepEqual(pending, original);
});

test("服务端素材经过真实 ZIP 导出导入后使用新本地键，嵌套引用与项目归属同时保留", async () => {
    const original = projects();
    const source = new Map([[imageKey, new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" })], [audioKey, new Blob(["audio-bytes"], { type: "audio/mpeg" })]]);
    const reads = new Map<string, number>();
    const archive = await buildCanvasArchive(original, async ({ storageKey }) => { reads.set(storageKey, (reads.get(storageKey) || 0) + 1); return source.get(storageKey)!; });
    const zip = await readZip(await createZip(archive));
    const data = JSON.parse(await zip.get("projects.json")!.text()) as CanvasExportFile;
    const local = new Map<string, Blob>();
    let sequence = 0;
    const imported = await prepareCanvasImport(data, zip, async (file, blob) => {
        const storageKey = `${file.mimeType.startsWith("image/") ? "image" : "file"}:new-${++sequence}`;
        local.set(storageKey, blob);
        return { storageKey, url: `blob:${storageKey}` };
    });

    assert.equal(reads.get(imageKey), 1, "共享素材只读取一次");
    assert.equal(local.size, 2);
    const rootMedia = imported[0].nodes[0].metadata!;
    const childMedia = imported[1].nodes[0].metadata!;
    assert.match(rootMedia.storageKey!, /^image:new-/);
    assert.match(childMedia.storageKey!, /^file:new-/);
    assert.equal(rootMedia.content, `blob:${rootMedia.storageKey}`);
    assert.equal(JSON.stringify(imported).includes("server:"), false);
    assert.equal(JSON.stringify(imported).includes(imageUrl), false);
    assert.equal(JSON.stringify(imported).includes(audioUrl), false);
    assert.deepEqual(new Uint8Array(await local.get(rootMedia.storageKey!)!.arrayBuffer()), new Uint8Array(await source.get(imageKey)!.arrayBuffer()));
    assert.equal(original[0].nodes[0].metadata!.storageKey, imageKey, "导入不能改写源数据");

    const saved: Array<{ id: string; workspaceId?: string }> = [];
    importCanvasProjectGroups(imported, (project, workspaceId) => { const id = `new-${project.id}`; saved.push({ id, workspaceId }); return id; });
    assert.deepEqual(saved, [{ id: "new-root", workspaceId: undefined }, { id: "new-child", workspaceId: "new-root" }]);
});

test("导出任一素材下载失败时拒绝产出导出包", async () => {
    await assert.rejects(buildCanvasArchive(projects(), async ({ storageKey }) => { if (storageKey === audioKey) throw new Error("远程文件已失效"); return new Blob(["image"], { type: "image/png" }); }), /远程文件已失效/);
});

test("制作计划、候选、音轨与字幕完整打包，新任务身份不会继承", async () => {
    const canvases = projects();
    canvases[0].nodes[0].metadata!.videoTaskId = "old-task";
    canvases[0].pendingAgentRequest = { prompt: "不可自动重跑", assets: [], skills: [] };
    canvases[0].chatSessions = [{ id: "old-chat", title: "创作记录", messages: [{id:"message",role:"user",text:"保留剧本"}], agentState:{phase:"video",approvedNodeIds:[],referenceNodeIds:[],pendingTaskIds:["old-task"],completedTaskIds:[]}, protocolMessages:[],createdAt:"",updatedAt:"" }];
    canvases[0].activeChatId = "old-chat";
    const doc = { id: "plan", workspaceId: "root", episodes: [{ id: "ep", title: "一", order: 0, script: "对白", delivery: { originalGain: 1, burnSubtitles: true, audioTracks: [{ id:"track",shotId:"shot",storageKey:audioKey,label:"配音",startSeconds:0,trimStartSeconds:0,durationSeconds:2,gain:1 }], subtitles: [{id:"sub",shotId:"shot",startSeconds:0,endSeconds:2,text:"对白"}] } }], scenes: [], assets: [{id:"asset",references:[{canvasId:"root",nodeId:"image"}]}], shots: [{id:"shot",episodeId:"ep",sceneId:"",assetIds:["asset"],canvasId:"",textNodeId:"",imageNodeId:"",videoNodeId:"",candidates:[{id:"candidate",canvasId:"root",nodeId:"image",storageKey:imageKey,content:"",kind:"image"}],selectedImageCandidateId:"candidate"}] } as unknown as ProductionDocument;
    const files = await buildCanvasArchive(canvases, async ({storageKey}) => new Blob([storageKey], {type:storageKey===audioKey?"audio/mpeg":"image/png"}), [doc]);
    const zip = await readZip(await createZip(files)); const data = JSON.parse(await zip.get("projects.json")!.text()) as CanvasExportFile;
    const restored = await prepareCanvasBundleImport(data,zip,async(file)=>({storageKey:`server:import-${file.storageKey}`,url:`blob:import-${file.storageKey}`}));
    const bundle=remapCanvasBundle(restored.projects,restored.productions);
    const result=remapProductionCanvases(bundle.productions[0],new Map([["root","new-root"],["child","new-child"]]));
    assert.equal(result.workspaceId,"new-root"); assert.equal(result.assets[0].references[0].nodeId,bundle.projects[0].nodes[0].id);
    assert.equal(result.shots[0].candidates[0].nodeId,bundle.projects[0].nodes[0].id);
    assert.equal(result.shots[0].selectedImageCandidateId,result.shots[0].candidates[0].id);
    assert.equal(result.episodes[0].delivery!.audioTracks[0].shotId,result.shots[0].id);
    assert.equal(result.episodes[0].delivery!.subtitles[0].shotId,result.shots[0].id);
    assert.equal(result.episodes[0].delivery!.audioTracks[0].storageKey,`server:import-${audioKey}`);
    assert.equal(bundle.projects[0].nodes[0].metadata!.videoTaskId,undefined);
    assert.equal(bundle.projects[0].pendingAgentRequest,undefined);
    assert.equal(bundle.projects[0].chatSessions[0].messages[0].text,"保留剧本");
    assert.deepEqual(bundle.projects[0].chatSessions[0].agentState.pendingTaskIds,[]);
    assert.notEqual(bundle.projects[0].activeChatId,"old-chat");
    assert.notEqual(bundle.projects[0].nodes[0].id,"image"); assert.notEqual(result.shots[0].id,"shot");
});

test("导入 ZIP 缺文件或文件被截断时，在写入任何素材前停止", async () => {
    const archive = await buildCanvasArchive(projects(), async () => new Blob(["complete-bytes"], { type: "image/png" }));
    const zip = await readZip(await createZip(archive));
    const data = JSON.parse(await zip.get("projects.json")!.text()) as CanvasExportFile;
    const path = data.projects[1].files.find((file) => file.storageKey === audioKey)!.path;
    let writes = 0;
    const storeFile = async () => { writes++; return { storageKey: "file:new", url: "blob:new" }; };
    const missing = new Map(zip); missing.delete(path);
    await assert.rejects(prepareCanvasImport(data, missing, storeFile), /缺失或不完整/);
    const truncated = new Map(zip); truncated.set(path, new Blob(["x"]));
    await assert.rejects(prepareCanvasImport(data, truncated, storeFile), /缺失或不完整/);
    assert.equal(writes, 0);
});
