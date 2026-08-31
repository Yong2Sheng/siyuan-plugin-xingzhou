export function automaticStatusForPlanDate(status: string, dateKey: string, todayKey: string): string | null {
    if (!dateKey) return status === "已计划" ? "待开始" : null;
    if (status !== "收件箱" && status !== "待开始" && status !== "已计划") return null;
    return dateKey <= todayKey ? "进行中" : "待开始";
}
