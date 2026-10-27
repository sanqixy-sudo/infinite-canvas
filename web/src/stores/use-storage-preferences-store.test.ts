import assert from "node:assert/strict";
import test from "node:test";
import axios, { type InternalAxiosRequestConfig } from "axios";

import { useStoragePreferencesStore } from "./use-storage-preferences-store";
import { useUserStore } from "./use-user-store";

function reply(config: InternalAxiosRequestConfig, enabled: boolean) {
    return { data: { code: 0, data: { autoSaveAssetsToCloud: enabled }, msg: "" }, status: 200, statusText: "OK", headers: {}, config };
}

test("storage preference defaults to browser and ignores obsolete loads after save or account change", async () => {
    const adapter = axios.defaults.adapter;
    useUserStore.setState({ token: "first", user: null });
    useStoragePreferencesStore.getState().reset();
    assert.equal(useStoragePreferencesStore.getState().autoSaveAssetsToCloud, false);
    assert.equal(useStoragePreferencesStore.getState().ready, false);
    let finish: ((enabled: boolean) => void) | undefined;
    axios.defaults.adapter = (config) => config.method === "post" ? Promise.resolve(reply(config, true)) : new Promise((resolve) => { finish = (enabled) => resolve(reply(config, enabled)); });
    try {
        const loading = useStoragePreferencesStore.getState().load("first");
        assert.equal(useStoragePreferencesStore.getState().load("first"), loading, "same-session loads are shared");
        await useStoragePreferencesStore.getState().save("first", true);
        finish!(false);
        await loading;
        assert.equal(useStoragePreferencesStore.getState().autoSaveAssetsToCloud, true);
        assert.equal(useStoragePreferencesStore.getState().ready, true);
        useStoragePreferencesStore.getState().reset();
        const previousLoad = useStoragePreferencesStore.getState().load("first");
        useUserStore.setState({ token: "second", user: null });
        finish!(true);
        await previousLoad;
        assert.equal(useStoragePreferencesStore.getState().token, "");
        assert.equal(useStoragePreferencesStore.getState().ready, false);
        assert.equal(useStoragePreferencesStore.getState().autoSaveAssetsToCloud, false);
    } finally { axios.defaults.adapter = adapter; useStoragePreferencesStore.getState().reset(); }
});
