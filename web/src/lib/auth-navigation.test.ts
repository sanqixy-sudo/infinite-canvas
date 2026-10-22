import assert from "node:assert/strict";
import test from "node:test";
import { loginHrefForPath, safeLoginRedirect } from "./auth-navigation";

test("login redirects preserve internal deep links and reject external or looping destinations", () => {
    assert.equal(safeLoginRedirect("/canvas/project-a?panel=assets#node-2"), "/canvas/project-a?panel=assets#node-2");
    assert.equal(loginHrefForPath("/assets?scope=local#folder"), "/login?redirect=%2Fassets%3Fscope%3Dlocal%23folder");
    for (const input of [undefined, "https://other.example", "//other.example", "/\\other.example", "/path\\other", "/\t/other", "/%5cother", "/%0a/other", "/login", "/login?redirect=/canvas", "/x/../login", "/admin/login"]) assert.equal(safeLoginRedirect(input), "/workspace", String(input));
});
