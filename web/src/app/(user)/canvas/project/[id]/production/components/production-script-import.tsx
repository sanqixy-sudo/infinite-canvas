"use client";

import { useEffect, useRef, useState } from "react";
import { Alert, Button, Checkbox, Input, Modal, Select } from "antd";
import { Upload } from "lucide-react";
import type { ProductionDocument } from "../../../../lib/production-types";
import { importProductionScript, splitProductionScript, type ScriptImportMode, type ScriptSection } from "../production-operations";

export default function ProductionScriptImport({ document, episodeId, error: saveError, onApply, onClose }: {
    document: ProductionDocument; episodeId: string; error: string; onApply: (update: (value: ProductionDocument) => { document: ProductionDocument; episodeId: string }) => boolean; onClose: () => void;
}) {
    const [source, setSource] = useState<{ title: string; text: string } | null>(null), [mode, setMode] = useState<ScriptImportMode>("new");
    const [error, setError] = useState(""), [reading, setReading] = useState(false), [confirmed, setConfirmed] = useState(false), [preview, setPreview] = useState(0);
    const input = useRef<HTMLInputElement>(null), request = useRef(0);
    const [original] = useState(() => document.episodes.find((item) => item.id === episodeId));
    useEffect(() => () => { request.current++; }, []);
    let sections: ScriptSection[] = [], validation = "";
    if (source) {
        try {
            sections = mode === "split" ? splitProductionScript(source.text, source.title) : [{ title: source.title, script: source.text }];
            importProductionScript(document, sections, mode, episodeId, original?.script);
        } catch (failure) { validation = failure instanceof Error ? failure.message : "请检查导入内容"; }
    }
    const read = async (file: File) => {
        const version = ++request.current; setReading(true); setError(""); setSource(null); setConfirmed(false); setPreview(0);
        try {
            if (!/\.(txt|md|markdown)$/i.test(file.name)) throw new Error("请选择 TXT 或 Markdown 剧本文件。");
            if (file.size > 2 * 1024 * 1024) throw new Error("剧本文件最多 2 MiB，请拆分后导入。");
            let text = "";
            try { text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer()).replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trim(); }
            catch { throw new Error("文件不是有效 UTF-8 文本，请在编辑器中另存为 UTF-8 后导入。"); }
            if (text.includes("\u0000") || !text) throw new Error("文件没有有效的剧本正文。");
            if (version === request.current) setSource({ title: file.name.replace(/\.(txt|md|markdown)$/i, "").slice(0, 100) || "导入剧本", text });
        } catch (failure) { if (version === request.current) setError(failure instanceof Error ? failure.message : "文件读取失败"); }
        finally { if (version === request.current) setReading(false); }
    };
    const apply = () => {
        if (!source || validation || (mode === "replace" && !confirmed)) return;
        if (onApply((value) => importProductionScript(value, sections, mode, episodeId, original?.script))) onClose();
    };
    return <Modal open title="导入剧本" width={850} onCancel={onClose} mask={{ closable: false }} footer={<div className="flex justify-end gap-2"><Button onClick={onClose}>取消</Button><Button type="primary" disabled={reading || !source || Boolean(validation) || (mode === "replace" && !confirmed)} onClick={apply}>确认导入本机草稿</Button></div>}>
        <div className="space-y-5 py-3">
            <p className="text-xs leading-6 text-muted-foreground">支持 UTF-8 编码的 TXT / Markdown，最多 2 MiB。先预览并选择导入方式；确认后加入本机草稿，保存计划后同步到账号。</p>
            <input ref={input} type="file" accept=".txt,.md,.markdown,text/plain,text/markdown" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; event.currentTarget.value = ""; if (file) void read(file); }} />
            <div className="flex flex-wrap items-center gap-3"><Button loading={reading} icon={<Upload className="size-4" />} onClick={() => input.current?.click()}>{source ? "重新选择文件" : "选择剧本文件"}</Button>{source && <span className="text-xs text-muted-foreground">{source.title} · {source.text.length.toLocaleString()} 字</span>}</div>
            <label className="block space-y-2 text-xs font-medium"><span>导入方式</span><Select className="w-full" value={mode} options={[{ value: "new", label: "整份新增一集 · 保留现有剧本" }, { value: "split", label: "按分集标题拆分 · 追加到现有分集之后" }, { value: "append", label: `追加到「${original?.title || "当前分集"}」剧本末尾`, disabled: !original }, { value: "replace", label: `替换「${original?.title || "当前分集"}」剧本正文`, disabled: !original }]} onChange={(value) => { setMode(value); setConfirmed(false); setPreview(0); }} /></label>
            {mode === "split" && <p className="text-xs leading-6 text-muted-foreground">识别独立一行的“第1集”“第 2 集：标题”“EP 3”等标题。标题之前的文字作为单独序篇保留，请检查分集预览。</p>}
            {(error || validation || saveError) && <Alert showIcon type="error" title={error || validation || saveError} />}
            {sections.length > 0 && <section className="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]"><nav aria-label="导入分集预览" className="max-h-72 space-y-1 overflow-auto rounded-lg bg-muted/40 p-2">{sections.map((section, index) => <button key={index} type="button" aria-current={preview === index ? "true" : undefined} className={`w-full rounded px-3 py-2 text-left text-xs ${preview === index ? "bg-accent font-medium" : "hover:bg-accent/50"}`} onClick={() => setPreview(index)}><span className="block truncate">{index + 1}. {section.title}</span><span className="mt-1 block text-muted-foreground">{section.script.length.toLocaleString()} 字</span></button>)}</nav><div className="min-w-0"><p className="mb-2 text-sm font-medium">{sections[preview]?.title}</p><Input.TextArea aria-label="即将导入的剧本预览" readOnly value={sections[preview]?.script || ""} rows={10} /></div></section>}
            {mode === "replace" && <><Alert type="warning" showIcon title="仅替换当前分集剧本，已有场次、镜头和制作结果保留。" description="原剧本正文将从当前草稿中移除，请先确认已经备份。" /><Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)}>我已检查预览，确认替换当前分集剧本</Checkbox></>}
            {source && !validation && <p className="text-xs text-muted-foreground">{mode === "split" || mode === "new" ? `将新增 ${sections.length} 集；现有 ${document.episodes.length} 集保留。` : "不会自动重新拆镜，也不会发起模型调用。"}</p>}
        </div>
    </Modal>;
}
