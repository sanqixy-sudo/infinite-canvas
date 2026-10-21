export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f2f4ee",
            dot: "rgba(65,89,72,.20)",
            line: "rgba(65,89,72,.08)",
            selectionStroke: "#327456",
            selectionFill: "rgba(50,116,86,.07)",
        },
        node: {
            label: "#53685a",
            fill: "#e8eee4",
            panel: "#fcfdf9",
            stroke: "#d6dfd2",
            activeStroke: "#327456",
            placeholder: "#8a998a",
            text: "#263b31",
            muted: "#6c7a70",
            faint: "#9da99c",
        },
        toolbar: {
            panel: "rgba(252,253,249,.96)",
            border: "#d6dfd2",
            item: "#53685a",
            itemHover: "#e8eee4",
            activeBg: "#e1eee4",
            activeText: "#286144",
        },
    },
    dark: {
        canvas: {
            background: "#161e19",
            dot: "rgba(181,205,187,.18)",
            line: "rgba(181,205,187,.07)",
            selectionStroke: "#91cfae",
            selectionFill: "rgba(145,207,174,.09)",
        },
        node: {
            label: "#bbcebf",
            fill: "#27382c",
            panel: "#1c2720",
            stroke: "#3a4b3f",
            activeStroke: "#91cfae",
            placeholder: "#7e9584",
            text: "#e7eee8",
            muted: "#9aafa0",
            faint: "#718676",
        },
        toolbar: {
            panel: "rgba(28,39,32,.96)",
            border: "#3a4b3f",
            item: "#bbcebf",
            itemHover: "#27382c",
            activeBg: "#2a4031",
            activeText: "#a9dab9",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
