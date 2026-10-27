"use client";

import { useAssetStore } from "@/stores/use-asset-store";
import { useUserStore } from "@/stores/use-user-store";
import { CanvasNodeType, type CanvasNodeData } from "../types";

export function useCanvasAssetSaveState(node: CanvasNodeData | null, saving = false) {
    const assets = useAssetStore((state) => state.cloudAssets);
    const token = useUserStore((state) => state.token);
    const key = node?.metadata?.storageKey;
    const saved = Boolean(token && node && assets.some((asset) => asset.kind === "text"
        ? node.type === CanvasNodeType.Text && asset.metadata?.nodeId === node.id && asset.data.content === node.metadata?.content
        : key?.startsWith("server:") && asset.data.storageKey === key));
    const local = Boolean(key && !key.startsWith("server:"));
    const label = saving ? "保存中" : saved ? "已存入账号" : node?.metadata?.accountSaveError ? "入库失败" : local || node?.type === CanvasNodeType.Text ? "当前浏览器" : "尚未归档";
    const detail = node?.metadata?.accountSaveError || (saved ? "已保存到账号素材库，可跨设备使用" : local ? "真实文件保存在当前浏览器；清除网站数据前请备份" : "尚未加入账号素材库，可手动存入");
    return { saved, label, detail };
}
