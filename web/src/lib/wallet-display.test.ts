import assert from "node:assert/strict";
import test from "node:test";
import { formatStoragePlanBytes, formatStorageBytes } from "./wallet-display";

test("storage entitlements keep the administrator's three decimal GB precision", () => {
    for (const [gb, expected] of [[0.001, "0.001 GB"], [0.125, "0.125 GB"], [1.234, "1.234 GB"], [10.125, "10.125 GB"], [100.001, "100.001 GB"], [10, "10 GB"]] as const) {
        assert.equal(formatStoragePlanBytes(Math.round(gb * 1024 ** 3)), expected);
    }
    assert.equal(formatStoragePlanBytes(1), "1 B");
    assert.equal(formatStoragePlanBytes(0), "0 GB");
    assert.equal(formatStorageBytes(10.125 * 1024 ** 3), "10 GB", "file usage still uses compact formatting");
});
