"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { App } from "antd";

import { fetchAdminCreditLogs } from "@/services/api/admin";
import { useUserStore } from "@/stores/use-user-store";

const defaultPageSize = 10;

export function useAdminCreditLogs() {
    const { message } = App.useApp();
    const token = useUserStore((state) => state.token);
    const clearSession = useUserStore((state) => state.clearSession);
    const [keyword, setKeyword] = useState("");
    const [date, setDate] = useState("");
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(defaultPageSize);

    const query = useQuery({
        queryKey: ["admin", "credit-logs", token, keyword, date, page, pageSize],
        queryFn: () => fetchAdminCreditLogs(token, { keyword, date, page, pageSize }),
        enabled: Boolean(token),
        retry: false,
    });

    useEffect(() => {
        if (query.isError) {
            const errorMessage = query.error instanceof Error ? query.error.message : "读取日志失败";
            message.error(errorMessage);
            if (errorMessage.includes("未登录") || errorMessage.includes("权限不足") || errorMessage.includes("登录状态无效")) clearSession();
        }
    }, [clearSession, message, query.error, query.isError]);

    const updateFilters = (next: Partial<{ keyword: string; date: string; page: number; pageSize: number }>) => {
        const queryState = { keyword, date, page, pageSize, ...next };
        if (next.keyword !== undefined || next.date !== undefined || next.pageSize !== undefined) queryState.page = 1;
        setKeyword(queryState.keyword);
        setDate(queryState.date);
        setPage(queryState.page);
        setPageSize(queryState.pageSize);
    };

    const data = query.data;

    return {
        logs: data?.items || [],
        keyword,
        date,
        page,
        pageSize,
        total: data?.total || 0,
        isLoading: query.isFetching,
        searchLogs: (value = keyword, selectedDate = date) => updateFilters({ keyword: value, date: selectedDate }),
        changePage: (value: number) => updateFilters({ page: value }),
        changePageSize: (value: number) => updateFilters({ pageSize: value }),
        resetFilters: () => updateFilters({ keyword: "", date: "", page: 1, pageSize: defaultPageSize }),
        refreshLogs: () => query.refetch(),
    };
}
