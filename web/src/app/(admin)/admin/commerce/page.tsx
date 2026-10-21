"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Switch, Table, Tabs, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { useEffect, useState } from "react";

import { fetchAdminPurchaseOrders, fetchCommerceSettings, reviewPurchaseOrder, saveCommerceSettings } from "@/services/api/admin-commerce";
import type { CommercePlan, CommerceSetting, PurchaseOrder } from "@/services/api/commerce";
import { useUserStore } from "@/stores/use-user-store";

const GB = 1024 ** 3;
const kindNames = { credits: "算力充值", storage: "存储扩容" };
const statusNames: Record<string, string> = { pending: "待确认", completed: "已完成", rejected: "已拒绝", canceled: "已取消" };
type SettingForm = { defaultStorageGB: number; contactText: string; instructions: string };
type PlanForm = { id: string; name: string; kind: "credits" | "storage"; priceYuan: number; credits: number; storageGB: number; description: string; enabled: boolean };
const money = (cents: number) => `¥${(cents / 100).toFixed(2)}`;
const benefit = (plan: Pick<CommercePlan, "kind" | "credits" | "storageBytes">) => plan.kind === "credits" ? `${plan.credits.toLocaleString()} 算力点` : `${Number((plan.storageBytes / GB).toFixed(3))} GB`;

export default function CommercePage() {
    const { message } = App.useApp();
    const queryClient = useQueryClient();
    const token = useUserStore((state) => state.token);
    const user = useUserStore((state) => state.user);
    const [form] = Form.useForm<SettingForm>();
    const [planForm] = Form.useForm<PlanForm>();
    const [reviewForm] = Form.useForm<{ remark: string }>();
    const [plans, setPlans] = useState<CommercePlan[]>([]);
    const [dirty, setDirty] = useState(false);
    const [saving, setSaving] = useState(false);
    const [editingPlan, setEditingPlan] = useState<string | null>(null);
    const [reviewing, setReviewing] = useState<{ order: PurchaseOrder; action: "complete" | "reject" } | null>(null);
    const [submittingReview, setSubmittingReview] = useState(false);
    const [page, setPage] = useState(1);
    const [status, setStatus] = useState("pending");
    const [kind, setKind] = useState("");
    const [keyword, setKeyword] = useState("");
    const enabled = Boolean(token && user?.role === "admin");
    const settings = useQuery({ queryKey: ["admin-commerce-settings", token], queryFn: () => fetchCommerceSettings(token), enabled, refetchOnWindowFocus: false });
    const orders = useQuery({ queryKey: ["admin-purchase-orders", token, page, status, kind, keyword], queryFn: () => fetchAdminPurchaseOrders(token, { page, pageSize: 20, status, kind, keyword }), enabled });
    const planKind = Form.useWatch("kind", planForm);

    useEffect(() => {
        form.resetFields();
        planForm.resetFields();
        reviewForm.resetFields();
        setPlans([]);
        setDirty(false);
        setEditingPlan(null);
        setReviewing(null);
        setSaving(false);
        setSubmittingReview(false);
        setPage(1);
    }, [token, form, planForm, reviewForm]);

    useEffect(() => {
        if (!settings.data) return;
        form.setFieldsValue({ defaultStorageGB: settings.data.defaultStorageBytes / GB, contactText: settings.data.contactText, instructions: settings.data.instructions });
        setPlans(settings.data.plans);
        setDirty(false);
    }, [form, settings.data]);

    const saveSettings = async () => {
        const requestToken = token;
        try {
            const values = await form.validateFields();
            if (useUserStore.getState().token !== requestToken) return;
            setSaving(true);
            const value: CommerceSetting = { defaultStorageBytes: Math.round(values.defaultStorageGB * GB), contactText: values.contactText || "", instructions: values.instructions || "", plans };
            const saved = await saveCommerceSettings(token, value);
            if (useUserStore.getState().token !== requestToken) return;
            queryClient.setQueryData(["admin-commerce-settings", token], saved);
            await queryClient.invalidateQueries({ queryKey: ["account-wallet"] });
            setDirty(false);
            message.success("默认空间和套餐已保存");
        } catch (error) { if (useUserStore.getState().token === requestToken && !(error && typeof error === "object" && "errorFields" in error)) message.error(error instanceof Error ? error.message : "保存失败"); }
        finally { if (useUserStore.getState().token === requestToken) setSaving(false); }
    };

    const editPlan = (plan?: CommercePlan) => {
        const id = plan?.id || crypto.randomUUID();
        planForm.resetFields();
        planForm.setFieldsValue({ id, name: plan?.name || "", kind: plan?.kind || "storage", priceYuan: plan ? plan.priceCents / 100 : undefined, credits: plan?.credits || undefined, storageGB: plan ? plan.storageBytes / GB : undefined, description: plan?.description || "", enabled: plan?.enabled ?? false });
        setEditingPlan(id);
    };
    const finishPlan = async () => {
        const requestToken = token;
        try {
        const values = await planForm.validateFields();
        if (useUserStore.getState().token !== requestToken) return;
        const plan: CommercePlan = { id: editingPlan!, name: values.name.trim(), kind: values.kind, priceCents: Math.round(values.priceYuan * 100), credits: values.kind === "credits" ? values.credits : 0, storageBytes: values.kind === "storage" ? Math.round(values.storageGB * GB) : 0, description: values.description || "", enabled: values.enabled };
        setPlans((current) => current.some((item) => item.id === plan.id) ? current.map((item) => item.id === plan.id ? plan : item) : [...current, plan]);
        setDirty(true);
        setEditingPlan(null);
        } catch (error) { if (error instanceof Error) message.error(error.message); }
    };
    const submitReview = async () => {
        if (!reviewing) return;
        const requestToken = token;
        try {
            const { remark } = await reviewForm.validateFields();
            if (useUserStore.getState().token !== requestToken) return;
            setSubmittingReview(true);
            await reviewPurchaseOrder(token, reviewing.order.id, reviewing.action, remark.trim());
            if (useUserStore.getState().token !== requestToken) return;
            await Promise.all([queryClient.invalidateQueries({ queryKey: ["admin-purchase-orders"] }), queryClient.invalidateQueries({ queryKey: ["account-wallet"] }), queryClient.invalidateQueries({ queryKey: ["purchase-orders"] })]);
            setReviewing(null);
            message.success(reviewing.action === "complete" ? "已确认并发放权益" : "申请已拒绝");
        } catch (error) { if (useUserStore.getState().token === requestToken && !(error && typeof error === "object" && "errorFields" in error)) message.error(error instanceof Error ? error.message : "审核失败"); }
        finally { if (useUserStore.getState().token === requestToken) setSubmittingReview(false); }
    };

    const planColumns: ColumnsType<CommercePlan> = [
        { title: "套餐", dataIndex: "name", render: (value, item) => <div><Typography.Text strong>{value}</Typography.Text><div><Typography.Text type="secondary">{kindNames[item.kind]} · {benefit(item)}</Typography.Text></div></div> },
        { title: "售价", render: (_, item) => money(item.priceCents), width: 120 },
        { title: "状态", dataIndex: "enabled", render: (value) => <Tag>{value ? "已上架" : "未上架"}</Tag>, width: 100 },
        { title: "操作", width: 150, render: (_, item) => <Space><Button size="small" onClick={() => editPlan(item)}>编辑</Button><Popconfirm title="移除这个套餐？" description="保存设置后停止新购，已有申请及权益保留。" onConfirm={() => { setPlans((current) => current.filter((plan) => plan.id !== item.id)); setDirty(true); }}><Button size="small" danger>移除</Button></Popconfirm></Space> },
    ];
    const orderColumns: ColumnsType<PurchaseOrder> = [
        { title: "申请用户", dataIndex: "userId", width: 190, render: (value, item) => <div><Typography.Text>{item.userDisplayName || "用户"}</Typography.Text><div><Typography.Text copyable ellipsis type="secondary" style={{ maxWidth: 160, fontSize: 11 }}>{value}</Typography.Text></div></div> },
        { title: "申请内容", render: (_, item) => <div><Typography.Text strong>{item.planName}</Typography.Text><div><Typography.Text type="secondary">{kindNames[item.kind]} · {benefit(item)}</Typography.Text></div></div> },
        { title: "金额", render: (_, item) => money(item.priceCents), width: 110 },
        { title: "状态", render: (_, item) => <Tag>{statusNames[item.status]}</Tag>, width: 100 },
        { title: "申请时间", dataIndex: "createdAt", render: (value) => dayjs(value).format("YYYY-MM-DD HH:mm"), width: 170 },
        { title: "审核备注", dataIndex: "reviewRemark", ellipsis: true },
        { title: "操作", width: 180, render: (_, item) => item.status === "pending" ? <Space><Button size="small" type="primary" disabled={submittingReview} onClick={() => { reviewForm.resetFields(); setReviewing({ order: item, action: "complete" }); }}>确认收款</Button><Button size="small" disabled={submittingReview} onClick={() => { reviewForm.resetFields(); setReviewing({ order: item, action: "reject" }); }}>拒绝</Button></Space> : "—" },
    ];

    return <main className="space-y-5 p-4 sm:p-6">
        <div><Typography.Title level={4}>充值与存储空间</Typography.Title><Typography.Text type="secondary">统一管理用户默认空间、充值套餐与人工确认申请。用户空间按账号累计，本地和 R2 共用额度。</Typography.Text></div>
        <Tabs items={[
            { key: "settings", label: "空间与套餐", children: <Space direction="vertical" size={20} style={{ width: "100%" }}>
                {settings.error ? <Card><Typography.Text type="danger">配置加载失败，请重试。</Typography.Text><Button onClick={() => void settings.refetch()}>重新加载</Button></Card> : null}
                <Card title="默认空间与充值说明" loading={settings.isLoading}>
                    <Form form={form} layout="vertical" onValuesChange={() => setDirty(true)}>
                        <Form.Item name="defaultStorageGB" label="每位用户的默认空间（GB）" rules={[{ required: true, message: "请输入默认空间" }]} extra="适用于全部账号。调低额度不删除文件，超额账号需清理文件或扩容后才能继续上传。"><InputNumber min={0} max={1000000} precision={3} step={1} style={{ width: 240 }} /></Form.Item>
                        <Form.Item name="contactText" label="充值联系信息"><Input maxLength={500} placeholder="例如客服微信、邮箱或处理说明" /></Form.Item>
                        <Form.Item name="instructions" label="人工充值说明" extra="展示给用户；请说明如何联系、核实收款及预计处理方式。"><Input.TextArea rows={3} maxLength={2000} showCount placeholder="用户提交申请后，管理员核实收款并发放算力点或存储空间。" /></Form.Item>
                    </Form>
                </Card>
                <Card title="购买套餐" extra={<Button onClick={() => editPlan()} disabled={!settings.data}>新增套餐</Button>}>
                    <Typography.Paragraph type="secondary">存储套餐为一次性长期扩容，算力套餐到账后增加点数。售价由你设置；修改套餐不会改变已有申请的金额与权益。套餐增加用户使用额度，请同时确保平台存储容量充足。</Typography.Paragraph>
                    <Table rowKey="id" columns={planColumns} dataSource={plans} pagination={false} scroll={{ x: 650 }} locale={{ emptyText: "尚无套餐，请新增并保存后上架" }} />
                </Card>
                <Space><Button type="primary" loading={saving} disabled={!settings.data} onClick={() => void saveSettings()}>保存全部设置</Button>{dirty ? <Typography.Text type="warning">有未保存的修改</Typography.Text> : null}</Space>
            </Space> },
            { key: "orders", label: "充值与扩容申请", children: <Card>
                <Space wrap style={{ marginBottom: 20 }}>
                    <Select aria-label="申请状态" value={status} onChange={(value) => { setStatus(value); setPage(1); }} style={{ width: 130 }} options={[{ value: "", label: "全部状态" }, ...Object.entries(statusNames).map(([value, label]) => ({ value, label }))]} />
                    <Select aria-label="申请类型" value={kind} onChange={(value) => { setKind(value); setPage(1); }} style={{ width: 140 }} options={[{ value: "", label: "全部类型" }, { value: "credits", label: "算力充值" }, { value: "storage", label: "存储扩容" }]} />
                    <Input.Search placeholder="搜索用户、套餐或申请编号" allowClear onSearch={(value) => { setKeyword(value); setPage(1); }} style={{ width: 260 }} />
                    <Button onClick={() => void orders.refetch()}>刷新</Button>
                </Space>
                {orders.error ? <Typography.Paragraph type="danger">申请加载失败，请重试。</Typography.Paragraph> : null}
                <Table rowKey="id" columns={orderColumns} dataSource={orders.data?.items || []} loading={orders.isLoading} scroll={{ x: 1050 }} pagination={{ current: page, pageSize: 20, total: orders.data?.total || 0, showSizeChanger: false, onChange: setPage }} />
            </Card> },
        ]} />
        <Modal title="编辑购买套餐" open={editingPlan !== null} onCancel={() => setEditingPlan(null)} onOk={() => void finishPlan()} okText="完成编辑" destroyOnHidden>
            <Form form={planForm} layout="vertical" preserve={false}>
                <Form.Item name="name" label="套餐名称" rules={[{ required: true, whitespace: true, message: "请输入套餐名称" }]}><Input maxLength={80} /></Form.Item>
                <Form.Item name="kind" label="类型" rules={[{ required: true }]}><Select options={[{ value: "credits", label: "算力充值" }, { value: "storage", label: "存储扩容" }]} /></Form.Item>
                <Form.Item name="priceYuan" label="售价（人民币元）" rules={[{ required: true, message: "请输入售价" }]}><InputNumber min={0.01} max={1000000} precision={2} style={{ width: "100%" }} /></Form.Item>
                {planKind === "credits" ? <Form.Item name="credits" label="到账算力点" rules={[{ required: true, message: "请输入点数" }]}><InputNumber min={0.01} max={100000000} precision={2} style={{ width: "100%" }} /></Form.Item> : <Form.Item name="storageGB" label="增加空间（GB）" rules={[{ required: true, message: "请输入容量" }]}><InputNumber min={0.001} max={1000000} precision={3} style={{ width: "100%" }} /></Form.Item>}
                <Form.Item name="description" label="套餐说明"><Input.TextArea rows={2} maxLength={500} /></Form.Item>
                <Form.Item name="enabled" label="上架" valuePropName="checked"><Switch /></Form.Item>
                <Typography.Text type="secondary">完成编辑后，请点击页面的“保存全部设置”。</Typography.Text>
            </Form>
        </Modal>
        <Modal title={reviewing?.action === "complete" ? "确认收款并发放权益" : "拒绝申请"} open={Boolean(reviewing)} closable={!submittingReview} keyboard={!submittingReview} mask={{ closable: !submittingReview }} cancelButtonProps={{ disabled: submittingReview }} onCancel={() => setReviewing(null)} onOk={() => void submitReview()} confirmLoading={submittingReview} okText={reviewing?.action === "complete" ? "已核实收款，确认发放" : "确认拒绝"}>
            {reviewing ? <div className="space-y-4"><div><p>{reviewing.order.planName} · {money(reviewing.order.priceCents)}</p><p>发放：{benefit(reviewing.order)}</p><p className="break-all text-xs text-[var(--ant-color-text-secondary)]">用户：{reviewing.order.userId}<br />申请编号：{reviewing.order.id}</p></div><Typography.Paragraph type="secondary">{reviewing.action === "complete" ? "请先核实已收到这笔款项。确认后将增加该用户的算力点或存储额度。" : "拒绝后不发放权益，用户可查看审核备注。"}</Typography.Paragraph><Form form={reviewForm} layout="vertical"><Form.Item name="remark" label="审核备注" rules={[{ required: true, whitespace: true, message: "请填写审核备注" }]}><Input.TextArea rows={3} maxLength={500} placeholder="填写核实依据或拒绝原因" /></Form.Item></Form></div> : null}
        </Modal>
    </main>;
}
