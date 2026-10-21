"use client";

import { App } from "antd";
import { useCallback } from "react";
import type { CanvasProject } from "../stores/use-canvas-store";
import { exportCanvasProjects } from "../utils/canvas-export";

export function useCanvasExport() {
    const { message } = App.useApp();
    return useCallback(async (projects: CanvasProject[], fileName?: string) => {
        if (!projects.length) return;
        const close = message.loading("正在打包画布和素材，请稍候…", 0);
        try { await exportCanvasProjects(projects, fileName); message.success("项目已完整打包并开始下载"); }
        catch (error) { message.error(error instanceof Error ? error.message : "导出失败，请稍后重试"); }
        finally { close(); }
    }, [message]);
}
