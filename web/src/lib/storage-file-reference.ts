// 仅识别媒体字段，避免把提示词、名称等文字中的文件 ID 当成实际引用。
export function hasStorageFileReference(value: unknown, id: string, origin: string): boolean {
    const visited = new WeakSet<object>();
    const matches = (text: string) => {
        if (text === `server:${id}`) return true;
        try {
            const url = new URL(text, origin);
            return url.origin === origin && url.pathname === `/api/files/${encodeURIComponent(id)}/content`;
        } catch { return false; }
    };
    const inspect = (item: unknown, field = ""): boolean => {
        if (typeof item === "string") return (field === "storageKey" || field === "url" || field.endsWith("Url") || field === "src" || field === "references") && matches(item);
        if (!item || typeof item !== "object" || visited.has(item)) return false;
        visited.add(item);
        return Array.isArray(item) ? item.some((child) => inspect(child, field)) : Object.entries(item).some(([key, child]) => inspect(child, key));
    };
    return inspect(value);
}
