"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { localForageStorage } from "@/lib/localforage-storage";
import { useUserStore } from "@/stores/use-user-store";

type CanvasVisit = { canvasId: string; ownerId: string; openedAt: string };

export const useCanvasActivityStore = create<{
    visits: CanvasVisit[];
    recordVisit: (canvasId: string) => void;
}>()(
    persist(
        (set) => ({
            visits: [],
            recordVisit: (canvasId) => {
                const ownerId = useUserStore.getState().user?.id || "guest";
                set((state) => ({ visits: [
                    { canvasId, ownerId, openedAt: new Date().toISOString() },
                    ...state.visits.filter((visit) => visit.canvasId !== canvasId || visit.ownerId !== ownerId),
                ].slice(0, 60) }));
            },
        }),
        { name: "xiaomeng:canvas-activity", storage: createJSONStorage(() => localForageStorage), partialize: (state) => ({ visits: state.visits }) },
    ),
);
