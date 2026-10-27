import assert from "node:assert/strict";
import test from "node:test";

import { hasStorageFileReference } from "./storage-file-reference";

test("browser draft media keys and signed content URLs protect the actual file", () => {
    const origin = "https://studio.example";
    assert.equal(hasStorageFileReference({ nodes: [{ metadata: { storageKey: "server:owned-file" } }] }, "owned-file", origin), true);
    assert.equal(hasStorageFileReference({ chatSessions: [{ references: [{ dataUrl: "/api/files/owned-file/content?access=signed" }] }] }, "owned-file", origin), true);
    assert.equal(hasStorageFileReference({ references: ["https://studio.example/api/files/owned-file/content"] }, "owned-file", origin), true);
    assert.equal(hasStorageFileReference({ imageUrl: "https://other.example/api/files/owned-file/content" }, "owned-file", origin), false);
});

test("prompts and similar IDs do not prevent deleting an unrelated file", () => {
    const value = { title: "server:owned-file", metadata: { prompt: "server:owned-file", storageKey: "server:owned-file-other" }, url: "/api/files/owned-file-other/content" };
    assert.equal(hasStorageFileReference(value, "owned-file", "https://studio.example"), false);
});
