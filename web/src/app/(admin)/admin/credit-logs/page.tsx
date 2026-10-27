"use client";

import { ProTable, type ProColumns } from "@ant-design/pro-components";
import { Button, Card, Col, DatePicker, Form, Input, Row, Space, Tag, theme, Typography } from "antd";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import type { AdminCreditLog } from "@/services/api/admin";
import { useAdminCreditLogs } from "./use-admin-credit-logs";

const creditLogTypeLabels: Record<string, string> = {
    recharge: "充值到账",
    admin_adjust: "后台调整",
    ai_consume: "模型消费",
    ai_refund: "失败返还",
};

export default function AdminCreditLogsPage() {
    const { token } = theme.useToken();
    const { logs, keyword, date, page, pageSize, total, isLoading, searchLogs, changePage, changePageSize, resetFilters, refreshLogs } = useAdminCreditLogs();
    const [keywordText, setKeywordText] = useState(keyword);

    useEffect(() => setKeywordText(keyword), [keyword]);

    const columns: ProColumns<AdminCreditLog>[] = [
        {
            title: "用户",
            dataIndex: "userDisplayName",
            width: 150,
            render: (_, item) => item.userDisplayName || "-",
        },
        {
            title: "用户 ID",
            dataIndex: "userId",
            width: 220,
            render: (_, item) => <Typography.Text copyable>{item.userId}</Typography.Text>,
        },
        {
            title: "类型",
            dataIndex: "type",
            width: 140,
            render: (_, item) => <Tag>{creditLogTypeLabels[item.type] || item.type || "-"}</Tag>,
        },
        {
            title: "变动",
            dataIndex: "amount",
            width: 100,
            render: (_, item) => <Typography.Text type={item.amount >= 0 ? "success" : "danger"}>{item.amount}</Typography.Text>,
        },
        {
            title: "余额",
            dataIndex: "balance",
            width: 100,
        },
        {
            title: "备注",
            dataIndex: "remark",
            ellipsis: true,
            render: (_, item) => <Typography.Text type="secondary">{item.remark || "-"}</Typography.Text>,
        },
        {
            title: "创建时间",
            dataIndex: "createdAt",
            width: 180,
            render: (_, item) => <Typography.Text type="secondary">{item.createdAt ? dayjs(item.createdAt).format("YYYY-MM-DD HH:mm:ss") : "-"}</Typography.Text>,
        },
    ];

    return (
        <main style={{ padding: 24 }}>
            <Space direction="vertical" size={16} style={{ width: "100%" }}>
                <Typography.Text type="secondary">流水由余额调整、模型扣点和失败返还自动生成，仅供审计。手动加点请前往用户管理设置余额。</Typography.Text>
                <Card variant="borderless">
                    <Form layout="vertical">
                        <Row gutter={16} align="bottom">
                            <Col flex="360px">
                                <Form.Item label="关键词">
                                    <Space.Compact block>
                                        <Input style={{ flex: 1, minWidth: 0 }} value={keywordText} placeholder="搜索用户名、用户 ID、类型、备注或关联 ID" allowClear onPressEnter={() => searchLogs(keywordText)} onChange={(event) => setKeywordText(event.target.value)} />
                                        <DatePicker style={{ width: 46, height: token.controlHeight, padding: 0, cursor: "pointer", background: token.colorPrimary, borderColor: token.colorPrimary }} styles={{ input: { opacity: 0, cursor: "pointer" }, suffix: { position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", marginInlineStart: 0, color: token.colorTextLightSolid } }} value={date ? dayjs(date) : null} format={() => ""} placeholder="" inputReadOnly allowClear={false} title={date || "选择日期"} onChange={(value) => searchLogs(keywordText, value?.format("YYYY-MM-DD") || "")} />
                                    </Space.Compact>
                                </Form.Item>
                            </Col>
                            <Col flex="none">
                                <Form.Item>
                                    <Space>
                                        <Button
                                            onClick={() => {
                                                setKeywordText("");
                                                resetFilters();
                                            }}
                                        >
                                            重置
                                        </Button>
                                        <Button type="primary" onClick={() => searchLogs(keywordText)}>
                                            查询
                                        </Button>
                                    </Space>
                                </Form.Item>
                            </Col>
                        </Row>
                    </Form>
                </Card>
                <ProTable<AdminCreditLog>
                    rowKey="id"
                    columns={columns}
                    dataSource={logs}
                    loading={isLoading}
                    search={false}
                    defaultSize="middle"
                    tableLayout="fixed"
                    cardProps={{ variant: "borderless" }}
                    headerTitle={
                        <Space>
                            <Typography.Text strong>算力点日志</Typography.Text>
                            <Tag>{total} 条</Tag>
                        </Space>
                    }
                    options={{ density: true, setting: true, reload: () => void refreshLogs() }}
                    toolBarRender={false}
                    pagination={{
                        current: page,
                        pageSize,
                        total,
                        showSizeChanger: true,
                        pageSizeOptions: [10, 20, 50, 100],
                        showTotal: (value) => `共 ${value} 条`,
                        onChange: (nextPage, nextPageSize) => (nextPageSize !== pageSize ? changePageSize(nextPageSize) : changePage(nextPage)),
                    }}
                />
            </Space>

        </main>
    );
}
