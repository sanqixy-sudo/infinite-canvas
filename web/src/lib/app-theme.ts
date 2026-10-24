import type { CSSProperties } from "react";
import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#222222",
        primaryHover: "#404040",
        primaryText: "#ffffff",
        menuBg: "#eeeeee",
        menuText: "#292929",
        selectActiveBg: "#f1f1f1",
        selectSelectedBg: "#e8e8e8",
        selectText: "#202020",
        background: "#f6f6f6",
        surface: "#ffffff",
        text: "#202020",
        muted: "#757575",
        border: "#e3e3e3",
        tableSelectedBg: "rgba(0, 0, 0, 0.04)",
        tableSelectedHoverBg: "rgba(0, 0, 0, 0.07)",
    },
    dark: {
        primary: "#f0f0f0",
        primaryHover: "#ffffff",
        primaryText: "#141414",
        menuBg: "#292929",
        menuText: "#f0f0f0",
        selectActiveBg: "#242424",
        selectSelectedBg: "#303030",
        selectText: "#ededed",
        background: "#111111",
        surface: "#1a1a1a",
        text: "#ededed",
        muted: "#a1a1a1",
        border: "#303030",
        tableSelectedBg: "rgba(255, 255, 255, 0.06)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.10)",
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
