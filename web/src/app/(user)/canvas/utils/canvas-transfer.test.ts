import assert from "node:assert/strict";
import test from "node:test";
import { createZip, readZip } from "@/lib/zip";
import type { CanvasExportFile } from "../export-types";
import type { CanvasProject } from "../stores/use-canvas-store";
import { buildCanvasArchive, importCanvasProjectGroups, prepareCanvasImport } from "./canvas-transfer";

const imageKey = "server:image-old";
const imageUrl = "/api/files/image-old/content?access=old";
const audioKey = "server:audio-old";
const audioUrl = "https://storage.example.test/audio.mp3";

function projects() {
    return [
        { id: "root", title: "画布 1", workspaceTitle: "项目", nodes: [{ id: "image", metadata: { storageKey: imageKey, content: imageUrl } }], references: [imageUrl] },
        { id: "child", workspaceId: "root", title: "画布 2", nodes: [{ id: "audio", metadata: { storageKey: audioKey, content: audioUrl, imageStorage: [{ storageKey: imageKey, url: imageUrl }] } }] },
    ] as unknown as CanvasProject[];
}

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
