#!/usr/bin/env node
/**
 * Rights-cleared synthetic project, real loopback HTTP bridge:
 * map + event + PBS write/readback, graphics, root confinement, byte preservation.
 * This does not simulate a physical Android provider or launch RPG Maker XP.
 */
import assert from "node:assert/strict";
import { randomBytes, createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const originalZip = resolve(process.argv[2] || "");
if (!existsSync(originalZip)) throw Error("Provide a rights-cleared synthetic original.zip");
const hash = path => createHash("sha256").update(readFileSync(path)).digest("hex");
const originalHash = hash(originalZip);
const temp = mkdtempSync(join(tmpdir(), "essentials-browser-smoke-"));
const token = randomBytes(32).toString("hex");
let bridge;

function findRoot(dir, depth = 0) {
  if (existsSync(join(dir, "Game.rxproj"))) return dir;
  if (depth >= 5) return null;
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    if (item.isDirectory()) {
      const found = findRoot(join(dir, item.name), depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function call(command, args = {}, auth = token) {
  const body = JSON.stringify({ command, args });
  return new Promise((resolveCall, rejectCall) => {
    const req = httpRequest({
      hostname: "127.0.0.1", port: 5174, path: "/invoke", method: "POST",
      headers: {
        Host: "127.0.0.1:5174",
        Origin: "http://127.0.0.1:5173",
        Authorization: "Bearer " + auth,
        "Content-Type": "application/json",
        "X-Essentials-Client": "browser-dev",
        "Content-Length": Buffer.byteLength(body),
      },
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (response.statusCode !== 200 || payload.ok !== true) {
            rejectCall(Error(payload.error || "Browser bridge rejected command"));
          } else resolveCall(payload.result);
        } catch (error) { rejectCall(error); }
      });
    });
    req.on("error", rejectCall);
    req.end(body);
  });
}

function waitForReady(child) {
  return new Promise((resolveReady, rejectReady) => {
    let output = "";
    const timer = setTimeout(() => rejectReady(Error("Browser bridge did not start")), 30000);
    const onData = chunk => {
      output += chunk.toString();
      if (output.includes("Browser bridge ready")) {
        clearTimeout(timer);
        resolveReady();
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", chunk => { process.stderr.write(chunk); });
    child.on("error", error => { clearTimeout(timer); rejectReady(error); });
    child.on("exit", code => {
      clearTimeout(timer);
      rejectReady(Error("Browser bridge exited before ready: " + code));
    });
  });
}

try {
  execFileSync("python3", ["-c",
    "import sys,zipfile;zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])",
    originalZip, temp,
  ]);
  const project = findRoot(temp);
  assert.ok(project, "Synthetic ZIP must contain one RMXP project root");
  const root = realpathSync(project);
  const protectedPaths = [
    "Data/Scripts.rxdata", "Data/System.rxdata",
    "Graphics/Tilesets/Synthetic.png", "Game.rxproj", "Game.ini",
  ];
  const protectedHashes = Object.fromEntries(protectedPaths.map(p => [p, hash(join(root, p))]));
  const mapBefore = hash(join(root, "Data/Map001.rxdata"));
  const pbsBefore = hash(join(root, "PBS/pokemon.txt"));

  bridge = spawn(resolve("src-tauri/target/debug/browser_bridge"), [], {
    env: {
      ...process.env,
      ESSENTIALS_BROWSER_TOKEN: token,
      ESSENTIALS_BROWSER_PROJECT_ROOT: root,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitForReady(bridge);

  assert.equal(await call("project_root"), root);
  const opened = await call("open_project", { path: root });
  assert.equal(opened.edit_map_id, 1);
  const map = await call("load_map", { projectPath: root, mapId: 1 });
  assert.equal(map.width, 2);
  assert.equal(map.height, 2);
  assert.equal(map.tiles.length, 12);
  const tiles = [...map.tiles];
  tiles[4] = 777;
  await call("save_map", { projectPath: root, mapId: 1, tiles, width: 2, height: 2 });
  const savedMap = await call("load_map", { projectPath: root, mapId: 1 });
  assert.deepEqual(savedMap.tiles, tiles);

  const event = await call("load_event", { projectPath: root, mapId: 1, eventId: 7 });
  assert.equal(event.pages[0].list[0].parameters[0], "Synthetic dialogue");
  event.pages[0].list[0].parameters[0] = "Browser bridge dialogue";
  await call("save_event", { projectPath: root, mapId: 1, event });
  const savedEvent = await call("load_event", { projectPath: root, mapId: 1, eventId: 7 });
  assert.equal(savedEvent.pages[0].list[0].parameters[0], "Browser bridge dialogue");

  const pbs = await call("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  const name = pbs[0].fields.find(field => field.key === "Name");
  assert.ok(name);
  name.value = "BrowserBridge";
  await call("save_pbs_file", { projectPath: root, filename: "pokemon.txt", sections: pbs });
  const savedPbs = await call("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  assert.equal(savedPbs[0].fields.find(field => field.key === "Name").value, "BrowserBridge");
  assert.ok(readFileSync(join(root, "PBS/pokemon.txt"), "utf8").includes("# synthetic PBS"));

  const image = await call("read_private_project_image", {
    projectPath: root, assetType: "tileset", assetName: "Synthetic",
  });
  assert.ok(image.startsWith("data:image/png;base64,"));
  const eventGraphic = await call("get_asset_path", {
    projectPath: root, assetType: "character", assetName: "SyntheticGuide",
  });
  assert.ok(eventGraphic.startsWith("data:image/png;base64,"));

  await assert.rejects(call("load_map", { projectPath: temp, mapId: 1 }), /selected project root/);
  await assert.rejects(call("begin_project_archive_export", { projectPath: root }), /does not support/);
  await assert.rejects(call("project_root", {}, "invalid"), /authentication/);

  for (const [path, before] of Object.entries(protectedHashes)) {
    assert.equal(hash(join(root, path)), before, "Unedited file changed: " + path);
  }
  assert.notEqual(hash(join(root, "Data/Map001.rxdata")), mapBefore);
  assert.notEqual(hash(join(root, "PBS/pokemon.txt")), pbsBefore);
  assert.equal(hash(originalZip), originalHash, "Original ZIP was modified");
  console.log(JSON.stringify({
    status: "synthetic HTTP bridge roundtrip passed",
    project: "rights-cleared synthetic RMXP fixture",
    originalZipSha256: originalHash,
    editedMapSha256: hash(join(root, "Data/Map001.rxdata")),
    editedPbsSha256: hash(join(root, "PBS/pokemon.txt")),
    unchangedMembers: protectedPaths.length,
    runtimeNotVerified: ["React browser UI", "Android SAF provider", "desktop RMXP", "JoiPlay/NaviaXP"],
  }, null, 2));
} finally {
  if (bridge && !bridge.killed) bridge.kill("SIGTERM");
  rmSync(temp, { recursive: true, force: true });
}
