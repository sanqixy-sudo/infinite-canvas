import Link from "next/link";

export default function LegalPage() {
    return (
        <main className="h-full overflow-y-auto bg-background px-6 py-12 text-foreground">
            <article className="mx-auto max-w-3xl space-y-6 leading-7">
                <h1 className="text-2xl font-semibold">许可与源码</h1>
                <p>小盟视频工作台基于 tigerowo 的 infinite-canvas 修改，2026 年由 sanqixy-sudo 进行二次开发。原项目基于 basketikun 的 infinite-canvas，并融合 HuFakai 的生图增强版。原作者的版权声明和许可文件均予保留。</p>
                <p>本程序依据 GNU Affero General Public License v3.0（AGPL-3.0）提供，不附带担保。你可以按该许可证再分发，并免费获取本服务所运行版本的对应源码、查看许可条款和原作者信息。</p>
                <p><Link className="underline underline-offset-4" href="/">返回首页</Link></p>
            </article>
        </main>
    );
}
