import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#327456",
        primaryHover: "#285f46",
        primaryText: "#ffffff",
        menuBg: "#e1eee4",
        menuText: "#286144",
        selectActiveBg: "#eaf0e8",
        selectSelectedBg: "#e1eee4",
        selectText: "#263b31",
        background: "#f3f5f0",
        surface: "#fcfdfb",
        text: "#263b31",
        muted: "#6c7a70",
        border: "#dee5dd",
        tableSelectedBg: "rgba(50, 116, 86, 0.07)",
        tableSelectedHoverBg: "rgba(50, 116, 86, 0.11)",
    },
    dark: {
        primary: "#91cfae",
        primaryHover: "#ade0c3",
        primaryText: "#183b27",
        menuBg: "#2a4031",
        menuText: "#a9dab9",
        selectActiveBg: "#26352b",
        selectSelectedBg: "#2a4031",
        selectText: "#e7eee8",
        background: "#141c18",
        surface: "#1c2720",
        text: "#e7eee8",
        muted: "#9aafa0",
        border: "#2d3b32",
        tableSelectedBg: "rgba(145, 207, 174, 0.08)",
        tableSelectedHoverBg: "rgba(145, 207, 174, 0.13)",
    },
};

export const adminLayoutStyle = {
    siderWidth: 232,
    headerHeight: 56,
    brandHeight: 56,
    menu: { borderInlineEnd: 0, padding: "18px 12px", fontSize: 15 } satisfies CSSProperties,
    menuItem: { height: 44, lineHeight: "44px", marginBlock: 4, borderRadius: 8 } satisfies CSSProperties,
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            colorBgLayout: color.background,
            colorBgContainer: color.surface,
            colorBgElevated: color.surface,
            colorText: color.text,
            colorTextSecondary: color.muted,
            colorBorder: color.border,
            colorBorderSecondary: color.border,
            borderRadius: 10,
            controlHeight: 38,
            fontFamily: '"SF Pro Text","PingFang SC","Microsoft YaHei",sans-serif',
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
