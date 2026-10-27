import type { CanvasProject } from "./stores/use-canvas-store";
import type { ProductionDocument } from "./lib/production-types";

export type CanvasExportFile = {
    app: "infinite-canvas";
    version: 3;
    exportedAt: string;
    projects: CanvasProjectExportItem[];
};

export type CanvasProjectExportItem = {
    project: CanvasProject;
    production?: ProductionDocument;
    files: CanvasExportAsset[];
};

export type CanvasExportAsset = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};
