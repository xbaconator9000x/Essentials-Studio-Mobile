#!/usr/bin/env node
/**
 * Private full-project, read-only native importer/bridge/export acceptance.
 * Never prints script source, dialogue, PBS values or map names. No game
 * assets are committed or uploaded. This is NOT Android SAF/RMXP/gameplay proof.
 * Usage: node scripts/private-project-sweep.mjs /private/project.zip
 * Optional: PRIVATE_SWEEP_EVIDENCE_DIR=/private/receipts
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function mapIds(project) {
  assert.ok(project && typeof project.map_infos === "object" && project.map_infos !== null, "Project must expose MapInfos");
  const ids = Object.keys(project.map_infos).map(Number).sort((a, b) => a - b);
  assert.ok(ids.length > 0, "Project contains no maps");
  assert.ok(ids.every(id => Number.isInteger(id) && id >= 1 && id <= 999), "Project has invalid map IDs");
  return ids;
}
export function validateMap(map, expectedId) {
  assert.equal(map?.id, expectedId, "Map ID mismatch: " + expectedId);
  assert.ok(Number.isInteger(map.width) && Number.isInteger(map.height) && map.width > 0 && map.height > 0, "Invalid map dimensions: " + expectedId);
  assert.ok(Array.isArray(map.tiles) && map.tiles.length === 3 * map.width * map.height, "Map does not contain exactly three XP layers: " + expectedId);
  assert.ok(map.tiles.every(tile => Number.isInteger(tile) && tile >= -32768 && tile <= 32767), "Map has non-i16 tile data: " + expectedId);
  assert.ok(Number.isInteger(map.tileset_id) && map.tileset_id > 0, "Invalid map tileset: " + expectedId);
  assert.ok(Array.isArray(map.events), "Map events unavailable: " + expectedId);
  const seen = new Set();
  for (const event of map.events) {
    assert.ok(Number.isInteger(event.id) && event.id > 0 && !seen.has(event.id), "Duplicate/invalid event ID in map " + expectedId);
    seen.add(event.id);
    assert.ok(Number.isInteger(event.page_count) && event.page_count >= 0, "Invalid event page count in map " + expectedId);
  }
  return { events: map.events.length, tilesetId: map.tileset_id };
}
export function validateEvent(event, mapId, info) {
  assert.equal(event?.id, info.id, "Event ID mismatch in map " + mapId);
  assert.ok(Array.isArray(event.pages) && event.pages.length === info.page_count, "Event page count mismatch in map " + mapId);
  let commands = 0;
  for (const page of event.pages) {
    assert.ok(Array.isArray(page.list), "Invalid event command list in map " + mapId);
    for (const command of page.list) {
      assert.ok(Number.isInteger(command.code) && Number.isInteger(command.indent) && Array.isArray(command.parameters),
        "Malformed event command in map " + mapId);
      commands++;
    }
  }
  return { pages: event.pages.length, commands };
}
async function sha256(file) {
  const h = createHash("sha256");
  for await (const chunk of createReadStream(file)) h.update(chunk);
  return h.digest("hex");
}
async function run() {
  const input = process.argv[2];
  if (!input) throw Error("Pass a private, authorised RMXP/Essentials project ZIP");
  const original = resolve(input);
  if (!existsSync(original) || !statSync(original).isFile() || !original.toLowerCase().endsWith(".zip")) {
    throw Error("Input must be an existing .zip archive");
  }
  const originalHash = await sha256(original);
  const temp = mkdtempSync(join(tmpdir(), "essentials-private-sweep-"));
  const evidenceDir = process.env.PRIVATE_SWEEP_EVIDENCE_DIR ? resolve(process.env.PRIVATE_SWEEP_EVIDENCE_DIR) : null;
  let server;
  let launchError = null;
  const result = {
    status: "blocked", candidate: process.env.GITHUB_SHA || "local",
    originalZipSha256: originalHash, originalZipBytes: statSync(original).size,
    mapCount: 0, eventCount: 0, pageCount: 0, commandCount: 0,
    tilesetCount: 0, scriptCount: 0, pbsFileCount: 0,
    notVerified: ["physical Android SAF", "desktop RPG Maker XP reopen", "JoiPlay/NaviaXP gameplay"],
  };
  const invoke = async (command, args = {}) => {
    const response = await fetch("http://127.0.0.1:5173/api/browser/invoke", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Essentials-Client": "browser-dev", "Origin": "http://127.0.0.1:5173" },
      body: JSON.stringify({ command, args }), signal: AbortSignal.timeout(60_000),
    });
    const payload = await response.json();
    if (!response.ok || payload.ok !== true) throw Error(command + ": " + (payload.error || ("HTTP " + response.status)));
    return payload.result;
  };
  try {
    server = spawn("node", ["scripts/dev-web.mjs", original], {
      env: { ...process.env, ESSENTIALS_BROWSER_WORKSPACE: join(temp, "editable") },
      stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32",
    });
    // Never retain private project paths, script titles or asset filenames in logs.
    server.stdout.resume();
    server.stderr.resume();
    server.on("error", error => { launchError = error; });
    let root;
    const deadline = Date.now() + 360_000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (server.exitCode !== null) throw Error("dev:web exited with " + server.exitCode);
      try { root = await invoke("project_root"); if (root) break; } catch { /* startup */ }
      await new Promise(done => setTimeout(done, 800));
    }
    assert.ok(root && resolve(root).startsWith(resolve(temp) + "/"), "Native importer did not return an isolated project root");
    const project = await invoke("open_project", { path: root });
    const ids = mapIds(project);
    result.mapCount = ids.length;
    const tilesets = new Set();
    for (const mapId of ids) {
      const map = await invoke("load_map", { projectPath: root, mapId });
      const stats = validateMap(map, mapId);
      result.eventCount += stats.events;
      tilesets.add(stats.tilesetId);
      for (const info of map.events) {
        const event = await invoke("load_event", { projectPath: root, mapId, eventId: info.id });
        const eventStats = validateEvent(event, mapId, info);
        result.pageCount += eventStats.pages;
        result.commandCount += eventStats.commands;
      }
    }
    for (const tilesetId of tilesets) {
      const tileset = await invoke("load_tileset", { projectPath: root, tilesetId });
      assert.equal(tileset.id, tilesetId, "Native tileset readback failed");
    }
    result.tilesetCount = tilesets.size;
    const scripts = await invoke("load_script_list", { projectPath: root });
    assert.ok(Array.isArray(scripts), "Native script list unavailable");
    result.scriptCount = scripts.length;
    for (const script of scripts) {
      const source = await invoke("load_script_source", { projectPath: root, scriptId: script.id });
      assert.equal(typeof source, "string", "Native script UTF-8 read failed");
    }
    const pbsFiles = await invoke("list_pbs_files", { projectPath: root });
    assert.ok(Array.isArray(pbsFiles), "Native PBS file list unavailable");
    result.pbsFileCount = pbsFiles.length;
    for (const filename of pbsFiles) {
      assert.ok(/^[A-Za-z0-9_]+\.txt$/.test(filename), "Unsafe PBS filename");
      const raw = await invoke("read_raw_pbs_file", { projectPath: root, filename });
      assert.equal(typeof raw, "string", "Native PBS raw read failed");
    }
    const exported = await invoke("export_browser_project_archive", { projectPath: root });
    assert.ok(exported.path && statSync(exported.path).size === exported.size, "Native ZIP export receipt disagrees with saved file");
    const verification = JSON.parse(execFileSync("python3", [
      "scripts/verify_project_roundtrip.py", original, exported.path,
    ], { encoding: "utf8", timeout: 600_000 }));
    assert.equal(verification.status, "verified");
    assert.deepEqual(verification.approved_changed_files, [], "Read-only sweep must not modify archive members");
    assert.equal(await sha256(original), originalHash, "Original private ZIP changed");
    result.exportedZipSha256 = await sha256(exported.path);
    result.verification = verification;
    result.status = "native full-project read-only sweep and ZIP preservation passed";
  } catch (error) {
    result.failure = String(error.message || error).replaceAll(original, "[private archive]")
      .replaceAll(temp, "[working copy]").slice(0, 600);
    throw error;
  } finally {
    if (server && server.pid) {
      try { if (process.platform !== "win32") process.kill(-server.pid, "SIGTERM"); else server.kill("SIGTERM"); }
      catch { /* already exited */ }
    }
    if (evidenceDir) {
      mkdirSync(evidenceDir, { recursive: true });
      writeFileSync(join(evidenceDir, "private-sweep-receipt.json"), JSON.stringify(result, null, 2) + "\n");
    }
    rmSync(temp, { recursive: true, force: true });
    console.log(JSON.stringify(result, null, 2));
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run().catch(() => { console.error("Private full-project sweep failed; inspect the local, redacted receipt if configured."); process.exitCode = 1; });
}
