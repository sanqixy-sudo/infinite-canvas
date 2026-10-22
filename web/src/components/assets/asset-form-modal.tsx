"use client";

import { ChevronDown, Upload } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { App, AutoComplete, Button, Form, Input, Modal, Select, Space, Tag, TreeSelect, Typography } from "antd";

import { formatBytes, readFileAsDataUrl } from "@/lib/image-utils";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { saveAssetToAccountLibrary } from "@/services/account-asset-save";
import { useAssetStore, type Asset, type AssetInput, type AssetKind, type AudioAsset, type ImageAsset, type VideoAsset } from "@/stores/use-asset-store";
import { useStoragePreferencesStore } from "@/stores/use-storage-preferences-store";
import { useUserStore } from "@/stores/use-user-store";
import { folderTreeOptions, normalizeAssetFolderIds, normalizeAssetTags, type AssetScope } from "@/lib/asset-organization";

type AssetFormValues = {
    kind: AssetKind;
    title: string;
    coverUrl: string;
    tags: string[];
    folderIds: string[];
    category?: string;
    source?: string;
    content?: string;
};

type ImageDraft = ImageAsset["data"] | null;
type MediaDraft = VideoAsset["data"] | AudioAsset["data"] | null;

type AssetFormModalProps = {
    open: boolean;
    asset?: Asset | null;
    scope?: AssetScope;
    defaultFolderIds?: string[];
    onClose: () => void;
};

export function AssetFormModal({ open, asset = null, scope: requestedScope, defaultFolderIds, onClose }: AssetFormModalProps) {
    const { message } = App.useApp();
    const [form] = Form.useForm<AssetFormValues>();
    const coverInputRef = useRef<HTMLInputElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const mediaInputRef = useRef<HTMLInputElement>(null);
    const sessionRef = useRef({ version: 0, token: "", userId: "" });
    const busyRef = useRef(false);
    const assets = useAssetStore((state) => state.assets);
    const cloudAssets = useAssetStore((state) => state.cloudAssets);
    const localFolders = useAssetStore((state) => state.localFolders);
    const cloudFolders = useAssetStore((state) => state.cloudFolders);
    const token = useUserStore((state) => state.token);
    const preferences = useStoragePreferencesStore();
    const preferredScope: AssetScope = token && preferences.token === token && preferences.ready && preferences.autoSaveAssetsToCloud ? "cloud" : "local";
    const targetScope: AssetScope = asset ? cloudAssets.some((item) => item.id === asset.id) ? "cloud" : "local" : requestedScope ?? preferredScope;
    const folders = targetScope === "cloud" ? cloudFolders : localFolders;
    const initialFolderIds = (defaultFolderIds || []).filter((id) => folders.some((folder) => folder.id === id));
    const loginRequired = targetScope === "cloud" && !token;
    const scopeRef = useRef(targetScope);
    const addAsset = useAssetStore((state) => state.addAsset);
    const updateAsset = useAssetStore((state) => state.updateAsset);
    const [formKind, setFormKind] = useState<AssetKind>("text");
    const [imageDraft, setImageDraft] = useState<ImageDraft>(null);
    const [mediaDraft, setMediaDraft] = useState<MediaDraft>(null);
    const [saving, setSaving] = useState(false);
    const [uploading, setUploading] = useState(false);
    const coverUrl = Form.useWatch("coverUrl", form) || "";
    const title = Form.useWatch("title", form) || "";
    const tags = Form.useWatch("tags", form) || [];
    const content = Form.useWatch("content", form) || "";

    useLayoutEffect(() => {
        if (!open) return;
        const { token, user } = useUserStore.getState();
        sessionRef.current = { version: sessionRef.current.version + 1, token, userId: user?.id || "" };
        busyRef.current = false;
        setSaving(false);
        setUploading(false);
        setFormKind(asset?.kind || "text");
        setImageDraft(asset?.kind === "image" ? asset.data : null);
        setMediaDraft(asset?.kind === "video" || asset?.kind === "audio" ? asset.data : null);
        form.setFieldsValue(asset ? {
            kind: asset.kind,
            title: asset.title,
            coverUrl: asset.coverUrl,
            tags: asset.tags || [],
            folderIds: asset.folderIds || [],
            category: asset.category,
            source: asset.source,
            content: asset.kind === "text" ? asset.data.content : asset.kind === "image" ? asset.data.dataUrl : asset.data.url,
        } : { kind: "text", title: "", coverUrl: "", tags: [], folderIds: initialFolderIds, category: "", source: "手动添加", content: "" });
        return () => { sessionRef.current.version++; };
    }, [asset, form, open]);

    useLayoutEffect(() => {
        if (open && scopeRef.current !== targetScope) form.setFieldValue("folderIds", asset?.folderIds || initialFolderIds);
        scopeRef.current = targetScope;
    }, [asset, form, open, targetScope]);

    const currentSession = (session: typeof sessionRef.current) => {
        const { token, user } = useUserStore.getState();
        return session.version === sessionRef.current.version && session.token === token && session.userId === (user?.id || "");
    };

    const assertSession = (session: typeof sessionRef.current) => {
        if (!currentSession(session)) throw new Error("登录状态或素材窗口已变化，请重新打开后保存");
    };

    const saveAsset = async () => {
        if (busyRef.current) return;
        const session = { ...sessionRef.current };
        const scope = targetScope;
        busyRef.current = true;
        setSaving(true);
        try {
        assertSession(session);
        if (scope === "cloud" && !session.token) throw new Error("请先登录后再保存到账号素材库");
        const values = await form.validateFields();
        assertSession(session);
        const base = {
            title: values.title.trim(),
            coverUrl: values.coverUrl?.trim() || (values.kind === "image" && imageDraft ? imageDraft.dataUrl : ""),
            tags: normalizeAssetTags(values.tags || []),
            folderIds: normalizeAssetFolderIds(values.folderIds || [], folders),
            category: values.category?.trim(),
            source: values.source?.trim(),
            metadata: asset?.metadata || { source: "manual" },
        };

        const url = (values.content || "").trim();
        let nextAsset: AssetInput;
        if (values.kind === "text") {
            nextAsset = { ...base, kind: "text", data: { content: url } };
        } else if (values.kind === "image") {
            if (!url) throw new Error("请选择图片文件或填写图片 URL");
            let data = imageDraft?.dataUrl === url && imageDraft.storageKey ? imageDraft : null;
            if (!data) {
                const image = await uploadImage(url, { localOnly: true, token: session.token });
                assertSession(session);
                if (!image.storageKey) throw new Error(image.accountSaveError || "图片未能保存到浏览器，请重试");
                data = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
                setImageDraft(data);
                form.setFieldValue("content", data.dataUrl);
            }
            nextAsset = { ...base, coverUrl: base.coverUrl || data.dataUrl, kind: "image", data };
        } else {
            if (!url) throw new Error(values.kind === "video" ? "请选择视频文件或填写视频 URL" : "请选择音频文件或填写音频 URL");
            let data = mediaDraft?.url === url && mediaDraft.storageKey ? mediaDraft : null;
            if (!data) {
                const media = await uploadMediaFile(url, values.kind === "audio" ? "asset-audio" : "asset-video", undefined, session.token, true);
                assertSession(session);
                if (!media.storageKey) throw new Error(media.accountSaveError || "媒体未能保存到浏览器，请重试");
                data = { url: media.url, storageKey: media.storageKey, bytes: media.bytes, mimeType: media.mimeType, width: media.width || 0, height: media.height || 0 };
                setMediaDraft(data);
                form.setFieldValue("content", data.url);
            }
            nextAsset = values.kind === "video" ? { ...base, kind: "video", data: data as VideoAsset["data"] } : { ...base, kind: "audio", data };
        }
        assertSession(session);
        if (asset) {
            const tagsChanged = JSON.stringify([...(asset.tags || [])].sort()) !== JSON.stringify([...nextAsset.tags].sort());
            const foldersChanged = JSON.stringify([...(asset.folderIds || [])].sort()) !== JSON.stringify([...(nextAsset.folderIds || [])].sort());
            const organization = { ...(tagsChanged ? { tags: nextAsset.tags } : {}), ...(foldersChanged ? { folderIds: nextAsset.folderIds } : {}) };
            const originalKey = asset.kind === "text" ? "" : asset.data.storageKey;
            const nextKey = nextAsset.kind === "text" ? "" : nextAsset.data.storageKey;
            if (scope === "cloud" && (asset.kind !== nextAsset.kind || originalKey !== nextKey)) {
                const saved = await saveAssetToAccountLibrary({ ...nextAsset, id: asset.id }, session.token);
                assertSession(session);
                if (tagsChanged || foldersChanged) await useAssetStore.getState().updateCloudAsset(saved.id, organization, session.token);
            } else {
                const { tags: _tags, folderIds: _folderIds, ...details } = nextAsset;
                await updateAsset(asset.id, { ...details, ...organization });
            }
        } else if (scope === "cloud") await saveAssetToAccountLibrary(nextAsset, session.token);
        else addAsset(nextAsset);
        assertSession(session);
        message.success(asset ? "素材已更新" : "素材已保存");
        onClose();
        } catch (error) {
            if (currentSession(session) && !(error && typeof error === "object" && "errorFields" in error)) message.error(error instanceof Error ? error.message : "素材保存失败，请重试");
        } finally {
            if (session.version === sessionRef.current.version) { busyRef.current = false; setSaving(false); }
        }
    };

    const readFile = async (read: (token: string) => Promise<void>) => {
        if (busyRef.current) return;
        const session = { ...sessionRef.current };
        busyRef.current = true;
        setUploading(true);
        try { assertSession(session); await read(session.token); }
        catch (error) { if (currentSession(session)) message.error(error instanceof Error ? error.message : "读取文件失败"); }
        finally { if (session.version === sessionRef.current.version) { busyRef.current = false; setUploading(false); } }
    };

    const readCoverFile = async (file?: File) => {
        if (!file) return;
        const session = { ...sessionRef.current };
        await readFile(async () => {
            const dataUrl = await readFileAsDataUrl(file);
            assertSession(session);
            form.setFieldValue("coverUrl", dataUrl);
        });
    };

    const readImageFile = async (file?: File) => {
        if (!file || !file.type.startsWith("image/")) return;
        const session = { ...sessionRef.current };
        await readFile(async (token) => {
        const image = await uploadImage(file, { localOnly: true, token });
        assertSession(session);
        if (!image.storageKey) throw new Error(image.accountSaveError || "图片未能保存到浏览器，请重试");
        const draft = { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType };
        setImageDraft(draft);
        form.setFieldValue("content", draft.dataUrl);
        if (!form.getFieldValue("coverUrl")) form.setFieldValue("coverUrl", draft.dataUrl);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        });
    };

    const readMediaFile = async (file?: File) => {
        if (!file) return;
        if (formKind === "video" && !file.type.startsWith("video/")) return;
        if (formKind === "audio" && !file.type.startsWith("audio/") && !/\.(mp3|wav)$/i.test(file.name)) return;
        const session = { ...sessionRef.current };
        await readFile(async (token) => {
        const media = await uploadMediaFile(file, formKind === "audio" ? "asset-audio" : "asset-video", undefined, token, true);
        assertSession(session);
        if (!media.storageKey) throw new Error(media.accountSaveError || "媒体未能保存到浏览器，请重试");
        const draft = formKind === "audio" ? { url: media.url, storageKey: media.storageKey, bytes: media.bytes, mimeType: media.mimeType } : { url: media.url, storageKey: media.storageKey, width: media.width || 0, height: media.height || 0, bytes: media.bytes, mimeType: media.mimeType };
        setMediaDraft(draft);
        form.setFieldValue("content", media.url);
        if (!form.getFieldValue("title")) form.setFieldValue("title", file.name);
        });
    };

    return (
            <Modal title={asset ? "编辑素材" : "新增素材"} open={open} width={980} onCancel={() => { if (!busyRef.current) onClose(); }} onOk={() => void saveAsset()} confirmLoading={saving} okButtonProps={{ disabled: uploading || loginRequired }} cancelButtonProps={{ disabled: saving || uploading }} closable={!saving && !uploading} maskClosable={!saving && !uploading} keyboard={!saving && !uploading} okText="保存" cancelText="取消" destroyOnHidden>
                <div className="grid gap-6 pt-1 lg:grid-cols-[minmax(0,1fr)_320px]">
                    <Form form={form} layout="vertical" disabled={saving || uploading || loginRequired} requiredMark={false} initialValues={{ kind: "text", tags: [] }}>
                        <Typography.Paragraph type="secondary">保存位置：{targetScope === "cloud" ? "账号素材库" : "当前浏览器"}</Typography.Paragraph>
                        {loginRequired ? <Typography.Paragraph type="warning">请先登录后再将素材保存到账号素材库。</Typography.Paragraph> : null}
                        <Form.Item name="kind" label="类型">
                            <Select
                                options={[
                                    { label: "文本", value: "text" },
                                    { label: "图片", value: "image" },
                                    { label: "视频", value: "video" },
                                    { label: "音频", value: "audio" },
                                ]}
                                onChange={(value) => {
                                    setFormKind(value);
                                    setImageDraft(null);
                                    setMediaDraft(null);
                                    form.setFieldValue("content", "");
                                }}
                            />
                        </Form.Item>
                        <Form.Item name="title" label="标题" rules={[{ required: true, message: "请输入标题" }]}>
                            <Input size="large" placeholder="给素材起一个容易检索的名字" />
                        </Form.Item>
                        <Form.Item label="封面 URL">
                            <Space.Compact className="w-full">
                                <Form.Item name="coverUrl" noStyle><Input placeholder="可粘贴图片 URL，也可以上传本地封面" /></Form.Item>
                                <Button icon={<Upload className="size-3.5" />} onClick={() => coverInputRef.current?.click()}>
                                    上传
                                </Button>
                            </Space.Compact>
                        </Form.Item>
                        <Form.Item name="tags" label="标签">
                            <Select mode="tags" maxCount={50} tokenSeparators={[",", "，"]} options={Array.from(new Set(assets.flatMap((item) => item.tags || []))).sort().map((value) => ({ value }))} placeholder="输入标签后回车" />
                        </Form.Item>
                        <Form.Item name="folderIds" label="所属目录" extra={folders.length ? "可归入多个目录，不会复制素材文件" : "尚无目录，可先在“我的素材”中创建"}>
                            <TreeSelect multiple allowClear showSearch treeNodeFilterProp="title" maxCount={32} maxTagCount={3} treeData={folderTreeOptions(folders)} placeholder={targetScope === "cloud" ? "选择账号目录" : "选择浏览器目录"} />
                        </Form.Item>
                        <div className="grid gap-4 sm:grid-cols-2">
                            <Form.Item name="category" label="分类">
                                <AutoComplete allowClear suffixIcon={<ChevronDown className="size-3.5" />} options={Array.from(new Set(assets.flatMap((item) => item.category ? [item.category] : []))).map((value) => ({ value }))} placeholder="选择或输入分类" />
                            </Form.Item>
                            <Form.Item name="source" label="来源">
                                <Input placeholder="手动添加 / 画布 / 素材库" />
                            </Form.Item>
                        </div>
                        {formKind === "text" ? (
                            <Form.Item name="content" label="文本内容" rules={[{ required: true, message: "请输入文本内容" }]}>
                                <Input.TextArea rows={8} placeholder="保存提示词、说明文案、参考描述等文本素材" />
                            </Form.Item>
                        ) : (
                            <Form.Item label={formKind === "image" ? "图片内容" : formKind === "video" ? "视频内容" : "音频内容"} required>
                                <div className="rounded-lg border border-dashed border-stone-300 p-4 dark:border-stone-700">
                                    <Space.Compact className="w-full">
                                        <Form.Item name="content" noStyle><Input placeholder={formKind === "image" ? "填写图片 URL，或选择本地图片文件" : formKind === "video" ? "填写视频 URL，或选择本地视频文件" : "填写音频 URL，或选择本地音频文件"} /></Form.Item>
                                        <Button icon={<Upload className="size-4" />} onClick={() => (formKind === "image" ? imageInputRef.current?.click() : mediaInputRef.current?.click())}>
                                            上传
                                        </Button>
                                    </Space.Compact>
                                    <div className="mt-2">
                                        {formKind === "image" && imageDraft ? (
                                            <Typography.Text type="secondary" className="text-xs">
                                                {imageDraft.width}x{imageDraft.height} · {formatBytes(imageDraft.bytes)}
                                            </Typography.Text>
                                        ) : (formKind === "video" || formKind === "audio") && mediaDraft ? (
                                            <Typography.Text type="secondary" className="text-xs">
                                                {"width" in mediaDraft ? `${mediaDraft.width}x${mediaDraft.height} · ` : ""}{typeof mediaDraft.bytes === "number" ? formatBytes(mediaDraft.bytes) : ""} · {mediaDraft.mimeType}
                                            </Typography.Text>
                                        ) : (
                                            <Typography.Text type="secondary" className="text-xs">
                                                {uploading ? "正在读取并保存文件…" : "未选择文件"}
                                            </Typography.Text>
                                        )}
                                    </div>
                                </div>
                            </Form.Item>
                        )}
                    </Form>
                    <div className="rounded-xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-800 dark:bg-stone-950">
                        <Typography.Text strong>预览</Typography.Text>
                        <div className="mt-3 overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
                            {coverUrl || imageDraft?.dataUrl ? (
                                <img src={coverUrl || imageDraft?.dataUrl} alt="" className="aspect-[4/3] w-full object-cover" />
                            ) : formKind === "video" && (mediaDraft?.url || content) ? (
                                <video src={mediaDraft?.url || content} className="aspect-[4/3] w-full bg-black object-contain" controls />
                            ) : formKind === "audio" && (mediaDraft?.url || content) ? (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 dark:bg-stone-900"><audio src={mediaDraft?.url || content} controls className="w-full" /></div>
                            ) : (
                                <div className="flex aspect-[4/3] items-center justify-center bg-stone-100 p-5 text-center text-sm text-stone-500 dark:bg-stone-900">{content || "暂无封面"}</div>
                            )}
                            <div className="p-4">
                                <Typography.Text strong ellipsis className="block">
                                    {title || "未命名素材"}
                                </Typography.Text>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                    {tags.length ? (
                                        tags.map((tag) => (
                                            <Tag key={tag} className="m-0">
                                                {tag}
                                            </Tag>
                                        ))
                                    ) : (
                                        <Tag className="m-0">未打标签</Tag>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <input
                    ref={coverInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readCoverFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(event) => {
                        void readImageFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
                <input
                    ref={mediaInputRef}
                    type="file"
                    accept={formKind === "audio" ? "audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" : "video/*"}
                    className="hidden"
                    onChange={(event) => {
                        void readMediaFile(event.target.files?.[0]);
                        event.target.value = "";
                    }}
                />
            </Modal>

    );
}
