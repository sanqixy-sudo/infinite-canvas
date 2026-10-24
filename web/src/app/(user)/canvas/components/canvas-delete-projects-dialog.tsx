"use client";

import { useState } from "react";
import { App, Button, Modal } from "antd";

import { deleteCanvasProjects } from "@/services/api/canvas-tasks";
import { useAssetStore } from "@/stores/use-asset-store";
import { useCanvasStore, workspaceCanvases } from "../stores/use-canvas-store";
import { useCanvasUiStore } from "../stores/use-canvas-ui-store";

export function CanvasDeleteProjectsDialog() {
    const { message } = App.useApp();
    const [deleting, setDeleting] = useState(false);
    const ids = useCanvasUiStore((state) => state.deleteProjectIds);
    const projects = useCanvasStore((state) => state.projects);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const removeSelectedIds = useCanvasUiStore((state) => state.removeSelectedProjectIds);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const cleanupImages = useAssetStore((state) => state.cleanupImages);
    const expandedIds = Array.from(new Set(ids.flatMap((id) => {
        const item = projects.find((project) => project.id === id);
        return item && !item.workspaceId ? workspaceCanvases(projects, id).map((canvas) => canvas.id) : [id];
    })));
    const deletingWorkspace = ids.some((id) => projects.some((project) => project.id === id && !project.workspaceId));
    const confirm = async () => {
        setDeleting(true);
        try {
            await deleteCanvasProjects(expandedIds);
            deleteProjects(expandedIds);
            cleanupImages();
            removeSelectedIds(expandedIds);
            setDeleteIds([]);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败，请重试");
        } finally {
            setDeleting(false);
        }
    };

    return (
        <Modal
            title={deletingWorkspace ? "删除项目及画布？" : "删除画布？"}
            open={ids.length > 0}
            centered
            onCancel={() => setDeleteIds([])}
            footer={
                <>
                    <Button onClick={() => setDeleteIds([])}>取消</Button>
                    <Button danger type="primary" loading={deleting} onClick={() => void confirm()}>
                        删除
                    </Button>
                </>
            }
        >
            <p className="text-sm text-muted-foreground">将删除 {expandedIds.length} 张画布，里面的节点和连线也会一起移除。{deletingWorkspace ? "项目也将从列表中移除。" : ""}</p>
        </Modal>
    );
}
