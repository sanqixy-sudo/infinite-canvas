import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type Position } from "../types";
import { getNodeBounds } from "./canvas-group";

/** A position-only preview. Group/batch membership, media and edges remain untouched. */
export function layoutCanvasNodes(nodes: CanvasNodeData[], connections: CanvasConnection[], selectedIds?: Iterable<string>): CanvasNodeData[] {
    if (!nodes.length) return nodes;
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const order = new Map(nodes.map((node, index) => [node.id, index]));
    const ownerById = new Map<string, string>();
    const ownerOf = (id: string) => {
        const path: string[] = [];
        let current = id;
        while (!ownerById.has(current) && !path.includes(current)) {
            path.push(current);
            const node = byId.get(current)!;
            const group = byId.get(node.metadata?.groupId || "");
            const batch = byId.get(node.metadata?.batchRootId || "");
            const parent = group?.type === CanvasNodeType.Group ? group : batch?.metadata?.isBatchRoot ? batch : undefined;
            if (!parent || parent.id === current) break;
            current = parent.id;
        }
        const root = ownerById.get(current) || (path.includes(current) && path.at(-1) !== current
            ? path.slice(path.indexOf(current)).sort((a, b) => order.get(a)! - order.get(b)!)[0]
            : current);
        for (const item of path) ownerById.set(item, root);
        return root;
    };
    for (const node of nodes) ownerOf(node.id);
    const requested = selectedIds ? new Set(Array.from(selectedIds).filter((id) => byId.has(id)).map(ownerOf)) : null;
    const members = new Map<string, CanvasNodeData[]>();
    for (const node of nodes) {
        const owner = ownerById.get(node.id)!;
        const list = members.get(owner) || [];
        list.push(node);
        members.set(owner, list);
    }
    if (!members.size) return nodes;
    const allUnits = Array.from(members, ([id, children]) => {
        const visible = children.filter((node) => {
            const batch = byId.get(node.metadata?.batchRootId || "");
            return !batch?.metadata?.isBatchRoot || batch.metadata.imageBatchExpanded;
        });
        const bounds = getNodeBounds(visible.length ? visible : [byId.get(id)!]);
        return { id, bounds, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
    });
    const units = allUnits.filter((unit) => !requested || requested.has(unit.id));
    if (!units.length) return nodes;
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const outgoing = new Map(units.map((unit) => [unit.id, new Set<string>()]));
    const indegrees = new Map(units.map((unit) => [unit.id, 0]));
    for (const edge of connections) {
        const from = ownerById.get(edge.fromNodeId);
        const to = ownerById.get(edge.toNodeId);
        if (!from || !to || from === to || !unitById.has(from) || !unitById.has(to) || outgoing.get(from)!.has(to)) continue;
        outgoing.get(from)!.add(to);
        indegrees.set(to, indegrees.get(to)! + 1);
    }
    const startX = Math.min(...units.map((unit) => unit.bounds.left));
    const startY = Math.min(...units.map((unit) => unit.bounds.top));
    const positions = new Map<string, Position>();
    const gapX = 96;
    const gapY = 72;
    if (Array.from(outgoing.values()).every((edges) => !edges.size)) {
        let x = startX;
        let y = startY;
        let rowHeight = 0;
        units.forEach((unit, index) => {
            if (index && index % 4 === 0) { x = startX; y += rowHeight + gapY; rowHeight = 0; }
            positions.set(unit.id, { x, y });
            x += unit.width + gapX;
            rowHeight = Math.max(rowHeight, unit.height);
        });
    } else {
        const pending = new Set(units.map((unit) => unit.id));
        const levels = new Map(units.map((unit) => [unit.id, 0]));
        while (pending.size) {
            // A cycle is broken at the first unplaced node; no edge or data is removed.
            const id = Array.from(pending).find((item) => indegrees.get(item) === 0) || pending.values().next().value!;
            pending.delete(id);
            for (const to of outgoing.get(id)!) {
                if (!pending.has(to)) continue;
                indegrees.set(to, indegrees.get(to)! - 1);
                levels.set(to, Math.max(levels.get(to)!, levels.get(id)! + 1));
            }
        }
        const columns = new Map<number, typeof units>();
        for (const unit of units) {
            const level = levels.get(unit.id)!;
            columns.set(level, [...(columns.get(level) || []), unit]);
        }
        const orderedColumns = Array.from(columns).sort(([a], [b]) => a - b).map(([, column]) => column);
        const columnHeight = (column: typeof units) => column.reduce((height, unit) => height + unit.height, 0) + (column.length - 1) * gapY;
        const maxHeight = Math.max(...orderedColumns.map(columnHeight));
        let x = startX;
        for (const column of orderedColumns) {
            let y = startY + (maxHeight - columnHeight(column)) / 2;
            for (const unit of column) { positions.set(unit.id, { x, y }); y += unit.height + gapY; }
            x += Math.max(...column.map((unit) => unit.width)) + gapX;
        }
    }
    const stationary = allUnits.filter((unit) => !positions.has(unit.id));
    const overlapsStationary = units.some((unit) => {
        const position = positions.get(unit.id)!;
        return stationary.some(({ bounds }) => position.x < bounds.right && position.x + unit.width > bounds.left
            && position.y < bounds.bottom && position.y + unit.height > bounds.top);
    });
    if (overlapsStationary) {
        // Keep the original anchor whenever it is clear; otherwise move this preview as a whole.
        const dx = Math.max(...stationary.map((unit) => unit.bounds.right)) + gapX - Math.min(...Array.from(positions.values(), (position) => position.x));
        for (const [id, position] of positions) positions.set(id, { x: position.x + dx, y: position.y });
    }
    return nodes.map((node) => {
        const owner = ownerById.get(node.id)!;
        const position = positions.get(owner);
        if (!position) return node;
        const bounds = unitById.get(owner)!.bounds;
        const x = node.position.x + position.x - bounds.left;
        const y = node.position.y + position.y - bounds.top;
        return x === node.position.x && y === node.position.y ? node : { ...node, position: { x, y } };
    });
}
