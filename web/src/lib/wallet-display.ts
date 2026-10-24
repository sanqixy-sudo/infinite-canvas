import { formatBytes } from "./image-utils";

const creditsFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 2 });
const priceFormatter = new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY", maximumFractionDigits: 2 });
const storagePlanFormatter = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 3 });

export const formatCredits = (value: number) => creditsFormatter.format(value);
export const formatStorageBytes = (value: number) => formatBytes(value) || "0 B";
export const formatStoragePlanBytes = (value: number) => value > 0 && value < 0.0005 * 1024 ** 3 ? formatStorageBytes(value) : `${storagePlanFormatter.format(value / 1024 ** 3)} GB`;
export const formatPrice = (cents: number) => priceFormatter.format(cents / 100);
export const orderStatusLabels = { pending: "待人工确认", completed: "已完成", rejected: "已拒绝", canceled: "已取消" };
