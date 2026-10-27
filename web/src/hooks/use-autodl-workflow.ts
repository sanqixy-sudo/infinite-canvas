"use client";

import { useQueries, useQuery } from "@tanstack/react-query";
import { isAutoDLConfig } from "@/lib/autodl";
import { fetchAutoDLWorkflow, fetchAutoDLWorkflows } from "@/services/api/autodl";
import { channelIdForActiveModel, type AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function useAutoDLWorkflow(config: AiConfig, model = config.model) {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const channelId = channelIdForActiveModel({ ...config, model });
    const enabled = config.channelMode === "remote" && Boolean(token && channelId && model) && isAutoDLConfig(config, model);
    return useQuery({
        queryKey: ["autodl", userId, enabled ? channelId : "", model],
        queryFn: () => fetchAutoDLWorkflow(channelId, model),
        enabled,
        staleTime: 300_000,
    });
}

type AutoDLChannel = { id?: string; protocol?: string; baseUrl?: string };

export function useAutoDLWorkflowNames(channels: AutoDLChannel[]) {
    const token = useUserStore((state) => state.token);
    const userId = useUserStore((state) => state.user?.id);
    const channelIds = [...new Set(channels.filter((channel) => channel.protocol === "autodl" && channel.id).map((channel) => channel.id!))];
    const queries = useQueries({ queries: channelIds.map((channelId) => ({
        queryKey: ["autodl", userId, channelId, "workflows"],
        queryFn: () => fetchAutoDLWorkflows(channelId),
        enabled: Boolean(token),
        staleTime: 300_000,
    })) });
    return (model: string, channel?: AutoDLChannel | null) => {
        if (channel?.protocol !== "autodl") return model;
        return queries[channelIds.indexOf(channel.id || "")]?.data?.find((workflow) => workflow.uuid === model)?.name || model;
    };
}
