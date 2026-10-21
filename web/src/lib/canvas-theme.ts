export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f2f2f2",
            dot: "rgba(45,45,45,.18)",
            line: "rgba(45,45,45,.07)",
            selectionStroke: "#393939",
            selectionFill: "rgba(0,0,0,.06)",
        },
        node: {
            label: "#5f5f5f",
            fill: "#e8e8e8",
            panel: "#fcfcfc",
            stroke: "#d6d6d6",
            activeStroke: "#393939",
            placeholder: "#929292",
            text: "#242424",
            muted: "#757575",
            faint: "#a3a3a3",
        },
        toolbar: {
            panel: "rgba(252,252,252,.96)",
            border: "#d6d6d6",
            item: "#5f5f5f",
            itemHover: "#e8e8e8",
            activeBg: "#e4e4e4",
            activeText: "#242424",
        },
    },
    dark: {
        canvas: {
            background: "#141414",
            dot: "rgba(220,220,220,.17)",
            line: "rgba(220,220,220,.07)",
            selectionStroke: "#e6e6e6",
            selectionFill: "rgba(255,255,255,.08)",
        },
        node: {
            label: "#c2c2c2",
            fill: "#282828",
            panel: "#1c1c1c",
            stroke: "#3b3b3b",
            activeStroke: "#e6e6e6",
            placeholder: "#8b8b8b",
            text: "#ededed",
            muted: "#a1a1a1",
            faint: "#808080",
        },
        toolbar: {
            panel: "rgba(28,28,28,.96)",
            border: "#3b3b3b",
            item: "#c2c2c2",
            itemHover: "#282828",
            activeBg: "#333333",
            activeText: "#ededed",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
