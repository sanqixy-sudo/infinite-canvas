import assert from "node:assert/strict";
import test from "node:test";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../types";
import { layoutCanvasNodes } from "./canvas-layout";

const node = (id: string, x: number, y: number, width = 200, height = 300): CanvasNodeData => ({ id, type: CanvasNodeType.Video, title: id, position: { x, y }, width, height, metadata: { content: `https://example.test/${id}.mp4` } });
const edge = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId });

test("按连线分层且尊重横竖节点实际尺寸，预览不改变原数据", () => {
    const nodes = [node("result", 0, 0, 640, 360), node("image", 0, 0, 200, 600), node("text", 0, 0, 300, 200)];
    const edges = [edge("image", "result"), edge("text", "result")];
    const preview = layoutCanvasNodes(nodes, edges);
    const result = preview[0];
    for (const source of preview.slice(1)) assert.ok(result.position.x >= source.position.x + source.width + 96);
    assert.ok(preview[2].position.y >= preview[1].position.y + preview[1].height + 72);
    assert.deepEqual(nodes.map((item) => item.position), [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]);
    preview.forEach((item, index) => { assert.equal(item.metadata, nodes[index].metadata); assert.equal(item.id, nodes[index].id); });
    assert.deepEqual(layoutCanvasNodes(preview, edges), preview, "重复整理不改变相同图的排列");
});

test("整理组内节点会带整个组移动，折叠批次子项跟随但不撑大布局", () => {
    const group = { ...node("group", 600, 20, 300, 400), type: CanvasNodeType.Group };
    const root = node("root", 620, 40);
    root.metadata = { ...root.metadata, groupId: "group", isBatchRoot: true, batchChildIds: ["child"], primaryImageId: "child", imageBatchExpanded: false };
    const child = node("child", 4000, 4000);
    child.metadata = { ...child.metadata, batchRootId: "root" };
    const result = node("result", 0, 0);
    const nodes = [group, root, child, result];
    const preview = layoutCanvasNodes(nodes, [edge("child", "result")]);
    const dx = preview[0].position.x - group.position.x;
    const dy = preview[0].position.y - group.position.y;
    assert.deepEqual(preview[1].position, { x: root.position.x + dx, y: root.position.y + dy });
    assert.deepEqual(preview[2].position, { x: child.position.x + dx, y: child.position.y + dy });
    assert.equal(preview[3].position.x, preview[0].position.x + group.width + 96);
    const selected = layoutCanvasNodes(nodes, [], ["root"]);
    assert.equal(selected[3], result, "未选中的其他组不能移动");
});

test("环形连线与错误父级关系均有限终止，不删除连线或节点", () => {
    const a = { ...node("a", 100, 100), type: CanvasNodeType.Group };
    const b = { ...node("b", 0, 0), type: CanvasNodeType.Group };
    a.metadata = { groupId: "b" };
    b.metadata = { groupId: "a" };
    const nodes = [a, b, node("c", 0, 0), node("d", 0, 0)];
    const connections = [edge("a", "c"), edge("c", "d"), edge("d", "a")];
    const preview = layoutCanvasNodes(nodes, connections);
    assert.equal(preview.length, nodes.length);
    assert.equal(connections.length, 3);
    assert.ok(preview.every((item) => Number.isFinite(item.position.x) && Number.isFinite(item.position.y)));
});

test("局部整理优先保留原位置，发生碰撞时整体避让未选节点", () => {
    const nodes = [node("source", 0, 0), node("target", 800, 0), node("stationary", 300, 0, 400, 300)];
    const preview = layoutCanvasNodes(nodes, [edge("source", "target")], ["source", "target"]);
    assert.equal(preview[2], nodes[2]);
    assert.equal(preview[0].position.x, 300 + 400 + 96);
    assert.equal(preview[1].position.x, preview[0].position.x + nodes[0].width + 96);
    const clear = [node("source", 0, 0), node("target", 800, 0), node("stationary", 0, 800)];
    const anchored = layoutCanvasNodes(clear, [edge("source", "target")], ["source", "target"]);
    assert.deepEqual(anchored[0].position, { x: 0, y: 0 });
});
