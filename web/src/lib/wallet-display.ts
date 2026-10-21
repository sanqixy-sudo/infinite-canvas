import { formatBytes } from "./image-utils";

const creditsFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const priceFormatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });

export const formatCredits = (value: number) => creditsFormatter.format(value);
export const formatStorageBytes = (value: number) => formatBytes(value) || "0 B";
export const formatPrice = (cents: number) => priceFormatter.format(cents / 100);
export const orderStatusLabels = { pending: "待人工确认", completed: "已完成", rejected: "已拒绝", canceled: "已取消" };
