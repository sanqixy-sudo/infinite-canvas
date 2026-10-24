import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { listCanvasProjects, saveCanvasProject, syncCanvasProjects } from "@/services/api/canvas-tasks";
import { fetchUserConfig } from "@/services/api/user-config";
import { useUserStore } from "@/stores/use-user-store";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import type { CanvasAgentConfig, CanvasAssistantSession, CanvasConnection, CanvasNodeData, CanvasPendingAgentRequest, ViewportTransform } from "../types";

export type CanvasSidePanelState = {
    open: boolean;
    width: number;
};

export const DEFAULT_CANVAS_SIDE_PANEL: CanvasSidePanelState = { open: true, width: 280 };
export const DEFAULT_CANVAS_AGENT_PANEL: CanvasSidePanelState = { open: false, width: 464 };

export type CanvasProject = {
    id: string;
    title: string;
    /** Child canvases point to the first canvas in their workspace. */
    workspaceId?: string;
    /** Independent display name for the workspace's root canvas. */
    workspaceTitle?: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    agentConfig: CanvasAgentConfig | null;
    autoTitlePending: boolean;
    pendingAgentRequest?: CanvasPendingAgentRequest;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
    sidePanel: CanvasSidePanelState;
    agentPanel: CanvasSidePanelState;
};

type CanvasStore = {
    hydrated: boolean;
    ownerId: string;
    restoredLegacyRootIds: string[];
    loadError: string;
    retryLoad: () => void;
    projects: CanvasProject[];
    createProject: (title?: string, options?: { agentConfig?: CanvasAgentConfig; pendingAgentRequest?: CanvasPendingAgentRequest; workspaceId?: string; workspaceTitle?: string }) => string;
    importProject: (project: Partial<CanvasProject>, workspaceId?: string) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    renameWorkspace: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "agentConfig" | "autoTitlePending" | "backgroundMode" | "showImageInfo" | "viewport" | "sidePanel" | "agentPanel" | "pendingAgentRequest">>) => void;
    syncWithRemote: (token: string, syncEnabled: boolean) => Promise<void>;
    setSyncEnabled: (enabled: boolean) => void;
    readLegacyCanvasProjects: () => Promise<CanvasProject[]>;
    restoreLegacyCanvasProjects: (rootIds: string[]) => Promise<number>;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects" | "ownerId" | "restoredLegacyRootIds">;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let queuedPersistState: PersistedCanvasState | null = null;
let accountCanvasSyncEnabled = false;
let canvasLoadVersion = 0;
const projectSaveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingProjectSaves = new Map<string, { token: string; project: CanvasProject }>();
const savingProjects = new Set<string>();

function canvasSession() {
    const state = useUserStore.getState();
    return state.isReady && !state.authError && state.token && state.user?.id && state.user.role !== "guest" ? { token: state.token, userId: state.user.id, version: state.sessionVersion } : null;
}

function currentCanvasSession(session: NonNullable<ReturnType<typeof canvasSession>>) {
    const current = canvasSession();
    return current?.token === session.token && current.userId === session.userId && current.version === session.version;
}

function canvasBucket(userId: string) { return `${CANVAS_STORE_KEY}:user:${userId}`; }

function canEditCanvas() {
    const session = canvasSession();
    return Boolean(session && useCanvasStore.getState().hydrated && useCanvasStore.getState().ownerId === session.userId);
}

async function flushProjectSave(id: string) {
    if (savingProjects.has(id) || projectSaveTimers.has(id)) return;
    const pending = pendingProjectSaves.get(id);
    pendingProjectSaves.delete(id);
    if (!pending || !accountCanvasSyncEnabled || useUserStore.getState().token !== pending.token) return;

    savingProjects.add(id);
    await saveCanvasProject(pending.token, pending.project).catch(() => undefined);
    savingProjects.delete(id);
    void flushProjectSave(id);
}

function queueProjectSave(project: CanvasProject) {
    const token = useUserStore.getState().token;
    const previous = projectSaveTimers.get(project.id);
    if (previous) clearTimeout(previous);
    projectSaveTimers.delete(project.id);
    if (!token || !accountCanvasSyncEnabled) {
        pendingProjectSaves.delete(project.id);
        return;
    }
    pendingProjectSaves.set(project.id, { token, project });
    projectSaveTimers.set(
        project.id,
        setTimeout(() => {
            projectSaveTimers.delete(project.id);
            void flushProjectSave(project.id);
        }, 400),
    );
}

function cancelProjectSaves(ids: string[]) {
    ids.forEach((id) => {
        pendingProjectSaves.delete(id);
        const timer = projectSaveTimers.get(id);
        if (!timer) return;
        clearTimeout(timer);
        projectSaveTimers.delete(id);
    });
}

async function reconcileCanvasProjects(
    token: string,
    remoteProjects: CanvasProject[],
    localProjects: CanvasProject[],
) {
    const session = canvasSession();
    if (!session || session.token !== token) throw new Error("登录状态已变化，未同步旧账号画布");
    const remoteById = new Map(
        remoteProjects.map((project) => [project.id, project]),
    );
    const missingProjects = localProjects.filter(
        (project) => !remoteById.has(project.id),
    );
    const existingLocalProjects = localProjects.filter((project) =>
        remoteById.has(project.id),
    );
    const projects = missingProjects.length
        ? await syncCanvasProjects(token, missingProjects)
            .then((syncedProjects) =>
                mergeCanvasProjects(
                    syncedProjects,
                    existingLocalProjects,
                ),
            )
            .catch(() =>
                mergeCanvasProjects(remoteProjects, localProjects),
            )
        : mergeCanvasProjects(remoteProjects, existingLocalProjects);

    if (!currentCanvasSession(session)) throw new Error("登录状态已变化，未同步旧账号画布");
    localProjects.forEach((project) => {
        const remote = remoteById.get(project.id);
        if (
            remote &&
            Date.parse(project.updatedAt || "") >
            Date.parse(remote.updatedAt || "")
        ) {
            queueProjectSave(project);
        }
    });

    return projects;
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        const session = canvasSession();
        if (!session) return null;
        const [localValue, legacyValue] = await Promise.all([localForageStorage.getItem(canvasBucket(session.userId)), localForageStorage.getItem(name)]);
        if (!currentCanvasSession(session)) return null;
        const token = session.token;
        const localParsed = localValue
            ? (JSON.parse(localValue) as StorageValue<CanvasStore>)
            : null;
        let localProjects =
            (localParsed?.state as PersistedCanvasState)?.projects || [];
        const restoredLegacyRootIds = (localParsed?.state as PersistedCanvasState)?.restoredLegacyRootIds || [];

        if (token) {
            try {
                const [userConfig, remoteProjects] = await Promise.all([
                    fetchUserConfig(token),
                    listCanvasProjects(token),
                ]);
                if (!currentCanvasSession(session)) return null;
                accountCanvasSyncEnabled =
                    userConfig.syncCapabilities?.userData === true;
                // 原全局档仅自动吸收远端已确认属于当前账号的同 ID 更新。
                const remoteIds = new Set(remoteProjects.map((project) => project.id));
                const legacy = legacyValue ? (JSON.parse(legacyValue) as StorageValue<CanvasStore>)?.state?.projects || [] : [];
                localProjects = mergeCanvasProjects(localProjects, legacy.filter((project) => remoteIds.has(project.id)));

                if (accountCanvasSyncEnabled && localProjects.length > 0) {
                    const projects = await reconcileCanvasProjects(
                        token,
                        remoteProjects,
                        localProjects,
                    );

                    if (!currentCanvasSession(session)) return null;
                    const nextState = { projects, ownerId: session.userId, restoredLegacyRootIds };
                    const parsed = {
                        state: nextState,
                        version: 0,
                    } as StorageValue<CanvasStore>;
                    queuedPersistState = nextState;
                    await localForageStorage.setItem(
                        canvasBucket(session.userId),
                        JSON.stringify(parsed),
                    );
                    return parsed;
                }

                if (
                    remoteProjects.length > 0 &&
                    (accountCanvasSyncEnabled || !localProjects.length)
                ) {
                    const nextState = { projects: remoteProjects, ownerId: session.userId, restoredLegacyRootIds };
                    const parsed = {
                        state: nextState,
                        version: 0,
                    } as StorageValue<CanvasStore>;
                    queuedPersistState = nextState;
                    await localForageStorage.setItem(
                        canvasBucket(session.userId),
                        JSON.stringify(parsed),
                    );
                    return parsed;
                }
            } catch (error) {
                console.error(
                    "Failed to hydrate canvas projects from remote",
                    error,
                );
            }
        }

        if (!currentCanvasSession(session)) return null;
        const nextState = { projects: localProjects, ownerId: session.userId, restoredLegacyRootIds };
        queuedPersistState = nextState;
        return { state: nextState, version: 0 } as StorageValue<CanvasStore>;
    },

    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (!nextState.ownerId || !useCanvasStore.getState().hydrated) return;
        if (
            queuedPersistState &&
            queuedPersistState.projects === nextState.projects
        ) {
            return;
        }
        queuedPersistState = nextState;
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(() => {
            saveTimer = null;
            void localForageStorage.setItem(canvasBucket(nextState.ownerId), JSON.stringify(value));
        }, 400);
    },
    removeItem: async () => { /* 原全局档和账号缓存不随退出登录删除。 */ },
};

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            ownerId: "",
            restoredLegacyRootIds: [],
            loadError: "",
            retryLoad: () => selectCanvasSession(),
            projects: [],
            createProject: (title = "未命名画布", options) => {
                if (!canEditCanvas()) throw new Error("请先登录并等待画布加载完成");
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    workspaceId: options?.workspaceId,
                    workspaceTitle: options?.workspaceTitle,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    agentConfig: options?.agentConfig || null,
                    autoTitlePending: true,
                    pendingAgentRequest: options?.pendingAgentRequest,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                    sidePanel: DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: options?.pendingAgentRequest ? { ...DEFAULT_CANVAS_AGENT_PANEL, open: true } : DEFAULT_CANVAS_AGENT_PANEL,
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                }));
                queueProjectSave(project);
                return id;
            },
            importProject: (source, workspaceId) => {
                if (!canEditCanvas()) throw new Error("请先登录并等待画布加载完成");
                const now = new Date().toISOString();
                const project: CanvasProject = {
                    id: nanoid(),
                    title: source.title || "导入画布",
                    workspaceId,
                    workspaceTitle: workspaceId ? undefined : source.workspaceTitle,
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: (source.chatSessions || []).map((session) => ({ ...session, codexThreadId: undefined, codexServiceId: undefined })),
                    activeChatId: source.activeChatId || null,
                    agentConfig: source.agentConfig || null,
                    autoTitlePending: false,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                    sidePanel: source.sidePanel || DEFAULT_CANVAS_SIDE_PANEL,
                    agentPanel: source.agentPanel || DEFAULT_CANVAS_AGENT_PANEL,
                };
                set((state) => ({
                    projects: [project, ...state.projects],
                }));
                queueProjectSave(project);
                return project.id;
            },
            openProject: (id) =>
                get().projects.find((item) => item.id === id) || null,
            renameProject: (id, title) => {
                if (!canEditCanvas()) return;
                const project = get().projects.find(
                    (item) => item.id === id,
                );
                if (!project) return;
                const nextProject = {
                    ...project,
                    title: title.trim() || project.title,
                    autoTitlePending: false,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === id ? nextProject : item,
                    ),
                }));
                queueProjectSave(nextProject);
            },
            renameWorkspace: (id, title) => {
                if (!canEditCanvas()) return;
                const project = get().projects.find((item) => item.id === id && !item.workspaceId);
                if (!project || !title.trim()) return;
                const nextProject = { ...project, workspaceTitle: title.trim(), updatedAt: new Date().toISOString() };
                set((state) => ({ projects: state.projects.map((item) => item.id === id ? nextProject : item) }));
                queueProjectSave(nextProject);
            },
            deleteProjects: (ids) => {
                if (!canEditCanvas()) return;
                cancelProjectSaves(ids);
                set((state) => ({
                    projects: state.projects.filter(
                        (project) => !ids.includes(project.id),
                    ),
                }));
            },
            updateProject: (id, patch) => {
                if (!canEditCanvas()) return;
                const project = get().projects.find(
                    (item) => item.id === id,
                );
                if (!project) return;
                const nextProject = {
                    ...project,
                    ...patch,
                    updatedAt: new Date().toISOString(),
                };
                set((state) => ({
                    projects: state.projects.map((item) =>
                        item.id === id ? nextProject : item,
                    ),
                }));
                queueProjectSave(nextProject);
            },
            syncWithRemote: async (token, syncEnabled) => {
                const session = canvasSession();
                if (!session || session.token !== token || !canEditCanvas()) return;
                accountCanvasSyncEnabled = syncEnabled;
                if (!syncEnabled) return;
                const localProjects = get().projects;
                const remoteProjects = await listCanvasProjects(token).catch(
                    () => null,
                );
                if (!remoteProjects || !currentCanvasSession(session)) return;
                const projects = await reconcileCanvasProjects(
                    token,
                    remoteProjects,
                    localProjects,
                );
                if (!currentCanvasSession(session)) return;
                if (saveTimer) {
                    clearTimeout(saveTimer);
                    saveTimer = null;
                }
                const nextState = { projects, ownerId: session.userId, restoredLegacyRootIds: get().restoredLegacyRootIds };
                queuedPersistState = nextState;
                set(nextState);
                await localForageStorage.setItem(
                    canvasBucket(session.userId),
                    JSON.stringify({ state: nextState, version: 0 }),
                );
            },
            setSyncEnabled: (enabled) => {
                accountCanvasSyncEnabled = enabled;
            },
            readLegacyCanvasProjects: async () => {
                const session = canvasSession();
                if (!session) throw new Error("请先登录后恢复浏览器旧项目");
                const raw = await localForageStorage.getItem(CANVAS_STORE_KEY);
                if (!currentCanvasSession(session)) throw new Error("登录状态已变化，请重新打开恢复列表");
                const projects = raw ? (JSON.parse(raw) as StorageValue<CanvasStore>)?.state?.projects : [];
                if (!Array.isArray(projects)) return [];
                const owned = new Set(get().projects.map((project) => project.id));
                const restored = new Set(get().restoredLegacyRootIds);
                const remaining = projects.filter((project) => !owned.has(project.id) && !restored.has(project.id) && !restored.has(project.workspaceId || project.id));
                const available = new Set(remaining.map((project) => project.id));
                return remaining.map((project) => project.workspaceId && !available.has(project.workspaceId) ? { ...project, workspaceId: undefined } : project);
            },
            restoreLegacyCanvasProjects: async (rootIds) => {
                const session = canvasSession();
                if (!session || !canEditCanvas()) throw new Error("请先登录并等待画布加载完成");
                const legacy = await get().readLegacyCanvasProjects();
                if (!currentCanvasSession(session)) throw new Error("登录状态已变化，未恢复旧项目");
                const selected = new Set(rootIds);
                const roots = new Set(legacy.filter((project) => !project.workspaceId && selected.has(project.id)).map((project) => project.id));
                const projects = legacy.filter((project) => roots.has(project.id) || Boolean(project.workspaceId && roots.has(project.workspaceId)));
                const ids = new Map(projects.map((project) => [project.id, nanoid()]));
                const timestamp = new Date().toISOString();
                const restored = projects.map((project) => ({ ...project, id: ids.get(project.id)!, workspaceId: project.workspaceId ? ids.get(project.workspaceId) : undefined, updatedAt: timestamp, chatSessions: (project.chatSessions || []).map((session) => ({ ...session, codexThreadId: undefined, codexServiceId: undefined })) }));
                if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
                const snapshot = { projects: [...restored, ...get().projects], ownerId: session.userId, restoredLegacyRootIds: [...new Set([...get().restoredLegacyRootIds, ...roots])] };
                await localForageStorage.setItem(canvasBucket(session.userId), JSON.stringify({ state: snapshot, version: 0 }));
                if (!currentCanvasSession(session)) throw new Error("登录状态已变化，未将旧项目写入其他账号");
                set((state) => ({ projects: [...restored, ...state.projects], restoredLegacyRootIds: [...new Set([...state.restoredLegacyRootIds, ...roots])] }));
                restored.forEach(queueProjectSave);
                return restored.length;
            },
        }),
        {
            name: CANVAS_STORE_KEY,
            skipHydration: true,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                    ownerId: state.ownerId,
                    restoredLegacyRootIds: state.restoredLegacyRootIds,
                }) as StorageValue<CanvasStore>["state"],
        },
    ),
);

function selectCanvasSession() {
    const previous = useCanvasStore.getState();
    let previousSave: Promise<unknown> = Promise.resolve();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (previous.ownerId && previous.hydrated) {
        const snapshot = { projects: previous.projects, ownerId: previous.ownerId, restoredLegacyRootIds: previous.restoredLegacyRootIds };
        previousSave = Promise.resolve(localForageStorage.setItem(canvasBucket(previous.ownerId), JSON.stringify({ state: snapshot, version: 0 }))).catch(() => undefined);
    }
    cancelProjectSaves([...projectSaveTimers.keys()]);
    pendingProjectSaves.clear();
    accountCanvasSyncEnabled = false;
    queuedPersistState = null;
    const version = ++canvasLoadVersion;
    const session = canvasSession();
    useCanvasStore.setState({ ownerId: session?.userId || "", projects: [], restoredLegacyRootIds: [], hydrated: false, loadError: "" });
    if (!session) return;
    void previousSave.then(() => currentCanvasSession(session) ? canvasStorage.getItem(CANVAS_STORE_KEY) : null).then((value) => {
        if (version !== canvasLoadVersion || !currentCanvasSession(session)) return;
        const snapshot = value?.state as PersistedCanvasState | undefined;
        queuedPersistState = { projects: snapshot?.projects || [], ownerId: session.userId, restoredLegacyRootIds: snapshot?.restoredLegacyRootIds || [] };
        useCanvasStore.setState({ ...queuedPersistState, hydrated: true });
    }).catch((error) => {
        if (version === canvasLoadVersion && currentCanvasSession(session)) useCanvasStore.setState({ loadError: "无法读取画布缓存，原数据已保留，请重试。" });
    });
}

useUserStore.subscribe((state, previous) => {
    if (state.token !== previous.token || state.user?.id !== previous.user?.id || state.isReady !== previous.isReady || state.authError !== previous.authError || state.sessionVersion !== previous.sessionVersion) selectCanvasSession();
});

if (canvasSession()) selectCanvasSession();

export function workspaceRoot(project: CanvasProject) {
    return !project.workspaceId;
}

export function workspaceCanvases(projects: CanvasProject[], rootId: string) {
    return projects.filter((project) => project.id === rootId || project.workspaceId === rootId);
}

export function mergeCanvasProjects(
    remoteProjects: CanvasProject[],
    localProjects: CanvasProject[],
): CanvasProject[] {
    const projects = new Map<string, CanvasProject>();
    [...localProjects, ...remoteProjects].forEach((project) => {
        const previous = projects.get(project.id);
        if (
            !previous ||
            Date.parse(project.updatedAt || "") >=
            Date.parse(previous.updatedAt || "")
        ) {
            projects.set(project.id, project);
        }
    });
    return Array.from(projects.values()).sort(
        (a, b) =>
            Date.parse(b.updatedAt || "") -
            Date.parse(a.updatedAt || ""),
    );
}
