import test from "node:test";
import assert from "node:assert/strict";
import { redrawPrompt, redrawReferenceError, redrawSizeOptions } from "./canvas-image-redraw";

test("redraw excludes known text-only models and never invents resolution for aliases", () => {
    assert.ok(redrawReferenceError("GLM-Image"));
    assert.ok(redrawReferenceError("cogview-4"));
    assert.ok(redrawReferenceError("dall-e-3"));
    assert.deepEqual(redrawSizeOptions("custom-image-alias", 800, 1200).map((item) => item.size), ["auto"]);
    assert.deepEqual(redrawSizeOptions("gemini-2.5-flash-image", 800, 1200).map((item) => item.size), ["auto"]);
});

test("redraw keeps output within adapter options for portrait and landscape sources", () => {
    assert.equal(redrawSizeOptions("gpt-image-1", 720, 1280)[1].size, "1024x1536");
    assert.equal(redrawSizeOptions("gpt-image-1", 1280, 720)[1].size, "1536x1024");
    const options = redrawSizeOptions("gemini-3-pro-image-preview", 720, 1280);
    assert.deepEqual(options.slice(1).map((item) => [item.size, item.quality]), [["9:16", "medium"], ["9:16", "high"]]);
    assert.equal(redrawSizeOptions("gpt-image-1", 0, 0).length, 1);
    assert.match(redrawPrompt(" 保留服装纹理 "), /额外要求：保留服装纹理$/);
});
