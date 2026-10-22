"use client";

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import styles from "./landing-faq.module.css";

const questions = [
    { title: "如何开始第一部作品？", text: "登录后进入工作台，新建项目即可打开第一张画布。你可以添加文字、导入参考素材，再选择平台开放的模型开始创作。" },
    { title: "需要自己配置模型密钥吗？", text: "无需在浏览器填写供应商密钥。模型由平台统一配置，可用能力与使用方式以工作台实际开放清单为准。" },
    { title: "我的素材保存在哪里？", text: "在个人中心的“存储设置”选择默认保存位置：当前浏览器，或账号素材库。保存在当前浏览器的文件只在该浏览器可用；账号素材库使用平台配置的存储空间。" },
    { title: "创作和存储如何查看用量？", text: "登录后可在工作台查看算力余额与个人空间，在钱包查看记录、申请充值或扩容。实际套餐和模型计费以平台开放配置为准。" },
];

export default function LandingFaq() {
    const id = useId();
    const buttons = useRef<Array<HTMLButtonElement | null>>([]);
    const [openIndex, setOpenIndex] = useState<number | null>(0);

    const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
        let next: number;
        if (event.key === "ArrowDown") next = (index + 1) % questions.length;
        else if (event.key === "ArrowUp") next = (index + questions.length - 1) % questions.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = questions.length - 1;
        else return;
        event.preventDefault();
        buttons.current[next]?.focus();
    };

    return (
        <section id="questions" aria-labelledby={`${id}-title`} className={styles.section}>
            <div className={styles.intro}>
                <p className={styles.eyebrow}><span />开始之前</p>
                <h2 id={`${id}-title`}>你可能想了解</h2>
                <p className={styles.description}>从第一个项目，到每一次创作。<br />把常见的问题，提前说明白。</p>
            </div>
            <div className={styles.list}>
                {questions.map((question, index) => {
                    const open = openIndex === index;
                    const buttonId = `${id}-question-${index}`;
                    const panelId = `${id}-answer-${index}`;
                    return (
                        <article key={question.title} className={styles.item} data-open={open}>
                            <h3>
                                <button
                                    ref={(element) => { buttons.current[index] = element; }}
                                    id={buttonId}
                                    type="button"
                                    className={styles.button}
                                    aria-expanded={open}
                                    aria-controls={panelId}
                                    onClick={() => setOpenIndex((current) => current === index ? null : index)}
                                    onKeyDown={(event) => moveFocus(event, index)}
                                >
                                    <span className={styles.number} aria-hidden="true">0{index + 1}</span>
                                    <span>{question.title}</span>
                                    <span className={styles.icon} aria-hidden="true" />
                                </button>
                            </h3>
                            <div id={panelId} role="region" aria-labelledby={buttonId} aria-hidden={!open} inert={!open} className={styles.panel} data-open={open}>
                                <div className={styles.panelInner}><p className={styles.answer}>{question.text}</p></div>
                            </div>
                        </article>
                    );
                })}
            </div>
        </section>
    );
}
