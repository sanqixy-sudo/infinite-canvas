import type { WorkflowRef } from "@/lib/workflow-channel";
import type { AiConfig } from "@/stores/use-config-store";
import { useUserStore } from "@/stores/use-user-store";

export function requireCloudModelAccess(config?: Pick<AiConfig, "channelMode">) {
    if (config && config.channelMode !== "remote") throw new Error("已停用个人模型渠道，请选择平台云端模型");
    const token = useUserStore.getState().token;
    if (!token) throw new Error("请先登录后使用平台云端模型");
    return token;
}

export function requireCloudWorkflow(ref?: WorkflowRef) {
    if (ref && ref.scope !== "system") throw new Error("已停用个人工作流渠道，请重新选择平台云端工作流");
    return requireCloudModelAccess();
}
