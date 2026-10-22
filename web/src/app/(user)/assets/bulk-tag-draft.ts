export type BulkTagDraft = { counts: Map<string, number>; assetCount: number; addTags: string[]; removeTags: string[] };

export function createBulkTagDraft(assets: readonly { tags?: readonly string[] }[]): BulkTagDraft {
    const counts = new Map<string, number>();
    for (const asset of assets) for (const tag of new Set((asset.tags || []).map((value) => value.trim()).filter(Boolean))) counts.set(tag, (counts.get(tag) || 0) + 1);
    return { counts: new Map([...counts].sort(([a], [b]) => a.localeCompare(b, "zh-CN"))), assetCount: assets.length, addTags: [], removeTags: [] };
}

export function bulkTagValues(draft: BulkTagDraft) {
    const removed = new Set(draft.removeTags);
    return [...new Set([...draft.counts.keys()].filter((tag) => !removed.has(tag)).concat(draft.addTags))];
}

export function updateBulkTagDraft(draft: BulkTagDraft, values: readonly string[]): BulkTagDraft {
    const next = new Set(values.map((value) => value.trim()).filter(Boolean));
    if ([...next].some((tag) => [...tag].length > 80)) throw new Error("每个标签最多 80 字");
    const previous = new Set(bulkTagValues(draft));
    const added = new Set(draft.addTags);
    const removed = new Set(draft.removeTags);
    for (const tag of previous) if (!next.has(tag)) {
        added.delete(tag);
        if (draft.counts.has(tag)) removed.add(tag);
    }
    for (const tag of next) if (!previous.has(tag)) {
        removed.delete(tag);
        if ((draft.counts.get(tag) || 0) < draft.assetCount) added.add(tag);
    }
    return { ...draft, addTags: [...added], removeTags: [...removed] };
}
