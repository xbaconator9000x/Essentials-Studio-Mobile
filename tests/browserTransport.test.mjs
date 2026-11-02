import test from "node:test";
import assert from "node:assert/strict";
import { callBrowserBridge } from "../src/services/browserTransport.ts";

const origin = "http://127.0.0.1:5173";
const endpoint = "/api/browser/";

test("same-origin browser request sends JSON and no client-side bearer token", async () => {
  let url, options;
  const value = await callBrowserBridge("load_map", { mapId: 1 }, endpoint, origin, async (u, o) => {
    url = u; options = o;
    return { ok: true, json: async () => ({ ok: true, result: { id: 1 } }) };
  });
  assert.deepEqual(value, { id: 1 });
  assert.equal(url, origin + "/api/browser/invoke");
  assert.equal(options.credentials, "same-origin");
  assert.equal(options.headers.Authorization, undefined);
  assert.equal(options.headers["X-Essentials-Client"], "browser-dev");
  assert.deepEqual(JSON.parse(options.body), { command: "load_map", args: { mapId: 1 } });
});

test("cross-origin endpoints and remote page origins fail before network", async () => {
  let calls = 0;
  const request = async () => { calls++; throw Error("must not call"); };
  await assert.rejects(callBrowserBridge("load_map", {}, "http://127.0.0.1:5174/", origin, request), /same-origin/);
  await assert.rejects(callBrowserBridge("load_map", {}, endpoint, "https://remote.example", request), /local development/);
  assert.equal(calls, 0);
});

test("backend errors and non-JSON responses are not treated as saved", async () => {
  await assert.rejects(callBrowserBridge("save_map", {}, endpoint, origin, async () => ({
    ok: false, status: 400, json: async () => ({ ok: false, error: "Project path outside selected root" }),
  })), /outside selected root/);
  await assert.rejects(callBrowserBridge("save_map", {}, endpoint, origin, async () => ({
    ok: true, status: 200, json: async () => ({ ok: false, error: "Native write failed" }),
  })), /Native write failed/);
  await assert.rejects(callBrowserBridge("save_map", {}, endpoint, origin, async () => ({
    ok: true, status: 200, json: async () => { throw Error("html"); },
  })), /JSON response/);
});
