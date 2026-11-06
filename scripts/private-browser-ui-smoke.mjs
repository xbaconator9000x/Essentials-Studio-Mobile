#!/usr/bin/env node
/**
 * Actual React/Chromium -> Rust map, event and PBS edit/export/reimport acceptance.
 * Accepts an authorised full Essentials ZIP locally; CI supplies only a
 * rights-cleared synthetic ZIP. Never upload private screenshots or archives.
 *
 * Usage: node scripts/private-browser-ui-smoke.mjs /private/Shattered.zip
 * Optional: PRIVATE_BROWSER_UI_EVIDENCE_DIR=/private/receipts
 *
 * This does NOT verify Android SAF, desktop RMXP or JoiPlay/NaviaXP.
 */
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright-core";
import { findProjectShowText, mapTreeAncestors, expectedDialogueEdit } from "./private-browser-event-probe.mjs";

const input = resolve(process.argv[2] || "");
assert.ok(existsSync(input) && statSync(input).isFile() && input.toLowerCase().endsWith(".zip"),
  "Pass an authorised Essentials project ZIP");
const evidence = resolve(process.env.PRIVATE_BROWSER_UI_EVIDENCE_DIR ||
  join(tmpdir(), "essentials-private-react-evidence"));
mkdirSync(evidence, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), "essentials-private-react-"));
const sleep = ms => new Promise(done => setTimeout(done, ms));
const sha = async file => {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
};
const originalHash = await sha(input);
const result = {
  status: "blocked",
  candidate: process.env.GITHUB_SHA || "local",
  inputZipSha256: originalHash,
  inputZipBytes: statSync(input).size,
  stages: {},
  notVerified: ["Android physical SAF provider", "desktop RPG Maker XP reopen", "JoiPlay/NaviaXP gameplay"],
};
let server, browser, page, root;
let stage = "start";
let pbsSubstage = null;
async function invoke(command, args = {}) {
  const response = await fetch("http://127.0.0.1:5173/api/browser/invoke", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Essentials-Client": "browser-dev",
      Origin: "http://127.0.0.1:5173" },
    body: JSON.stringify({ command, args }),
    signal: AbortSignal.timeout(90_000),
  });
  const data = await response.json();
  if (!response.ok || data.ok !== true) throw Error(command + " failed: " + (data.error || response.status));
  return data.result;
}
try {
  server = spawn("node", ["scripts/dev-web.mjs", input], {
    env: { ...process.env, ESSENTIALS_BROWSER_WORKSPACE: join(temp, "editable") },
    stdio: "ignore", detached: process.platform !== "win32",
  });
  stage = "native ZIP import and browser startup";
  const deadline = Date.now() + 360_000;
  while (Date.now() < deadline) {
    if (server.exitCode !== null) throw Error("Browser backend exited before readiness");
    try { root = await invoke("project_root"); if (root) break; } catch { /* compiling */ }
    await sleep(900);
  }
  assert.ok(root && resolve(root).startsWith(resolve(temp) + "/"), "Importer did not isolate project root");
  result.stages.nativeImport = "passed";

  const chrome = [process.env.CHROME_BIN, "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium"].find(path => path && existsSync(path));
  assert.ok(chrome, "Chromium executable missing; set CHROME_BIN");
  browser = await chromium.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  stage = "React project open";
  await page.goto("http://127.0.0.1:5173/", { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.getByRole("button", { name: "Open Project Folder" }).click({ timeout: 60_000 });
  await page.getByRole("button", { name: "Export ZIP..." }).waitFor({ timeout: 120_000 });
  const project = await invoke("open_project", { path: root });
  const initialMapId = Number(project.edit_map_id);
  assert.ok(Number.isInteger(initialMapId) && initialMapId > 0 && initialMapId <= 999,
    "Invalid initial map ID");
  // A real Shattered project may start on a gate/intro map without a Show
  // Text command. Select a genuine existing dialogue event from MapInfos
  // instead of fabricating one or incorrectly failing the full-project gate.
  stage = "Find existing real-project dialogue and navigate map tree";
  const probe = await findProjectShowText(project,
    id => invoke("load_map", { projectPath: root, mapId: id }),
    (id, eventId) => invoke("load_event", { projectPath: root, mapId: id, eventId }));
  assert.ok(probe, "No existing editable Show Text found in the bounded project map scan");
  const mapId = probe.mapId;
  if (mapId !== initialMapId) {
    const ancestors = mapTreeAncestors(project.map_infos, mapId);
    for (const id of ancestors) {
      const name = page.locator(".map-tree-name")
        .filter({ hasText: new RegExp("^\\[" + String(id).padStart(3, "0") + "\\] ") });
      await name.waitFor({ timeout: 60_000 });
      const item = name.locator("..");
      if (await item.getAttribute("aria-expanded") === "false") {
        await item.locator(".map-tree-toggle").click();
      }
    }
    const name = page.locator(".map-tree-name")
      .filter({ hasText: new RegExp("^\\[" + String(mapId).padStart(3, "0") + "\\] ") });
    await name.click({ timeout: 60_000 });
    await page.waitForFunction(id => {
      const selected = document.querySelector(".map-tree-item.selected .map-tree-name");
      return selected?.textContent?.trim().startsWith(
        "[" + String(id).padStart(3, "0") + "] ");
    }, mapId, { timeout: 120_000 });
  }
  const before = await invoke("load_map", { projectPath: root, mapId });
  assert.ok(before.width > 0 && before.height > 0 && before.tiles.length === before.width * before.height * 3,
    "Invalid initial three-layer map");
  await page.locator(".map-editor-canvas").waitFor({ timeout: 120_000 });
  await page.screenshot({ path: join(evidence, "private-react-map-open.png"), fullPage: true });
  result.stages.reactProjectOpen = "passed";
  result.dialogueMapId = mapId;

  stage = "React map paint and save";
  // Choose an XP autotile family different from the first cell's family.
  const target = before.tiles[0] >= 48 && before.tiles[0] < 96 ? 96 : 48;
  await page.getByRole("button", { name: "Auto", exact: true }).click();
  await page.locator(".autotile-item").nth(target === 48 ? 0 : 1).click();
  await page.locator(".map-editor-canvas").click({ position: { x: 16, y: 16 } });
  const save = page.getByRole("button", { name: "Save All" });
  await save.waitFor({ state: "visible" });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Save All");
    return button && !button.disabled;
  }, null, { timeout: 30_000 });
  await save.click();
  await page.getByText(
    "All registered editor changes were saved to the working project. The imported source ZIP is unchanged; export a new ZIP to share your edits.",
    { exact: true },
  ).waitFor({ state: "visible", timeout: 60_000 });
  assert.equal(await sha(input), originalHash, "Save All must not modify the imported source ZIP");
  const after = await invoke("load_map", { projectPath: root, mapId });
  const changes = after.tiles.map((tile, index) => ({ tile, index }))
    .filter(({ tile, index }) => tile !== before.tiles[index]);
  assert.equal(changes.length, 1, "React map paint must persist exactly one cell");
  assert.ok(changes[0].tile >= 48 && changes[0].tile < 48 + 7 * 48, "Saved tile is not an XP autotile");
  assert.equal(Math.floor((changes[0].tile - 48) / 48), Math.floor((target - 48) / 48),
    "Saved tile is from the wrong selected autotile family");
  const mapPath = "Data/Map" + String(mapId).padStart(3, "0") + ".rxdata";
  result.stages.reactMapSave = "passed";
  await page.screenshot({ path: join(evidence, "private-react-map-saved.png"), fullPage: true });

  stage = "React existing dialogue event editing and save";
  // The project is a disposable native-imported copy. Do not create events or
  // change scripts just to make a test pass: require a genuine Show Text command.
  const canvas = page.locator(".map-editor-canvas");
  const bounds = await canvas.boundingBox();
  assert.ok(bounds && bounds.width >= 64 && bounds.height >= 64, "Map canvas is too small for event editing");
  const desiredX = Math.min(probe.x, Math.max(1, Math.floor(bounds.width / 96)));
  const desiredY = Math.min(probe.y, Math.max(1, Math.floor(bounds.height / 96)));
  const panX = probe.x - desiredX;
  const panY = probe.y - desiredY;
  await page.getByRole("button", { name: "Ev", exact: true }).click();
  if (panX || panY) {
    await page.mouse.move(bounds.x + 32, bounds.y + 32);
    await page.mouse.wheel(panX * 32, panY * 32);
    await page.waitForTimeout(350);
  }
  await canvas.dblclick({ position: { x: desiredX * 32 + 16, y: desiredY * 32 + 16 } });
  const eventEditor = page.locator(".event-editor");
  await eventEditor.waitFor({ timeout: 45_000 });
  if (probe.pageIndex > 0) {
    await eventEditor.getByRole("button", { name: "Page " + (probe.pageIndex + 1), exact: true }).click();
  }
  const updatedDialogue = "PrivateUiRoundtripProbeDialogue";
  assert.notEqual(probe.event.pages[probe.pageIndex].list[probe.commandIndex].parameters[0],
    updatedDialogue, "Dialogue probe must make a real change");
  if (probe.hasContinuation) {
    const originalList = probe.event.pages[probe.pageIndex].list;
    const lines = [updatedDialogue];
    for (let i = probe.commandIndex + 2; originalList[i]?.code === 401; i++) {
      lines.push(String(originalList[i].parameters[0] ?? ""));
    }
    await eventEditor.locator(".event-command-block").filter({ hasText: "Show Text" }).first().dblclick();
    const textarea = eventEditor.locator(".event-command-edit-textarea");
    await textarea.waitFor({ timeout: 15_000 });
    await textarea.fill(lines.join("\n"));
  } else {
    await eventEditor.locator(".event-command-row").filter({ hasText: "Show Text" }).first().dblclick();
    const field = eventEditor.locator(".event-command-edit-input");
    await field.waitFor({ timeout: 15_000 });
    await field.fill(updatedDialogue);
  }
  await eventEditor.locator(".event-editor-header").click();
  await eventEditor.locator(".event-command-params").filter({ hasText: updatedDialogue })
    .first().waitFor({ timeout: 15_000 });
  await eventEditor.getByRole("button", { name: "Save & close", exact: true }).click();
  await eventEditor.waitFor({ state: "hidden", timeout: 90_000 });
  const eventAfter = await invoke("load_event", { projectPath: root, mapId, eventId: probe.eventId });
  assert.deepEqual(eventAfter,
    expectedDialogueEdit(probe.event, probe.pageIndex, probe.commandIndex, updatedDialogue),
    "React dialogue edit must preserve all other event pages, commands and opaque metadata");
  const mapAfterEvent = await invoke("load_map", { projectPath: root, mapId });
  assert.equal(mapAfterEvent.tiles[changes[0].index], changes[0].tile,
    "Event save must not undo the previously painted map tile");
  result.stages.reactEventSave = "passed";
  result.eventProbe = { mapId, eventId: probe.eventId, pageIndex: probe.pageIndex,
    hasContinuation: probe.hasContinuation };
  await page.screenshot({ path: join(evidence, "private-react-event-saved.png"), fullPage: true });

  stage = "React PBS editing and save";
  pbsSubstage = "read-baseline";
  const pbsBefore = await invoke("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  const firstName = pbsBefore[0]?.fields?.find(field => field.key === "Name")?.value;
  assert.ok(typeof firstName === "string" && firstName.length > 0, "No first Pokémon Name field");
  pbsSubstage = "open-editor";
  await page.getByRole("button", { name: "PBS Data", exact: true }).click();
  const editor = page.locator(".pbs-entity-editor");
  await editor.waitFor({ timeout: 90_000 });
  pbsSubstage = "wait-for-pokemon-name-field";
  const nameField = editor.getByRole("textbox", { name: "Pokémon name", exact: true });
  await nameField.waitFor({ state: "visible", timeout: 90_000 });
  assert.equal(await nameField.inputValue(), firstName, "PBS editor did not select the first Pokémon");
  const replacement = "PrivateUiRoundtripProbe";
  assert.notEqual(firstName, replacement, "PBS probe must change a value");
  pbsSubstage = "edit-pokemon-name";
  await nameField.fill(replacement);
  pbsSubstage = "wait-for-dirty-state";
  await editor.getByText("Unsaved changes").waitFor({ timeout: 30_000 });
  pbsSubstage = "apply-pbs-changes";
  await page.waitForFunction(() => {
    const apply = [...document.querySelectorAll(".pbs-entity-editor button")]
      .find(button => button.textContent?.trim() === "Apply");
    return apply && !apply.disabled;
  }, null, { timeout: 30_000 });
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  pbsSubstage = "wait-for-save-completion";
  await editor.getByText("Unsaved changes").waitFor({ state: "hidden", timeout: 90_000 });
  pbsSubstage = "verify-native-write";
  const pbsAfter = await invoke("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  assert.equal(pbsAfter[0]?.fields?.find(field => field.key === "Name")?.value, replacement,
    "React PBS save did not persist through native backend");
  pbsSubstage = "close-editor";
  await editor.getByRole("button", { name: "Save & close", exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 30_000 });
  pbsSubstage = null;
  result.stages.reactPbsSave = "passed";
  await page.screenshot({ path: join(evidence, "private-react-pbs-saved.png"), fullPage: true });

  stage = "React ZIP export and independent preservation verification";
  await page.getByRole("button", { name: "Export ZIP..." }).click();
  const status = page.locator(".app-operation-status").filter({ hasText: "ZIP saved to local file:" });
  await status.waitFor({ timeout: 180_000 });
  const message = await status.innerText();
  const receipt = message.match(/ZIP saved to local file: (.+) \((\d+) bytes\)/);
  assert.ok(receipt, "React UI did not display native ZIP completion receipt");
  const exported = receipt[1];
  assert.equal(statSync(exported).size, Number(receipt[2]), "Native ZIP receipt size mismatch");
  assert.ok(!resolve(exported).startsWith(resolve(root) + "/"), "Export must not be inside project");
  const verify = JSON.parse(execFileSync("python3", [
    "scripts/verify_project_roundtrip.py", input, exported,
    "--allow-changed", mapPath, "--allow-changed", "PBS/pokemon.txt",
  ], { encoding: "utf8", timeout: 600_000 }));
  assert.equal(verify.status, "verified");
  assert.deepEqual(verify.approved_changed_files, [mapPath, "PBS/pokemon.txt"].sort(),
    "Exactly the intended map and PBS files must change");
  result.stages.zipPreservation = "passed";
  result.unchangedArchiveMembers = verify.unchanged_files ?? null;

  stage = "Native reimport and persisted file comparison";
  const reopened = execFileSync("src-tauri/target/debug/browser_archive", [
    "import", exported, join(temp, "reopened"),
  ], { encoding: "utf8", timeout: 360_000 }).trim();
  for (const relative of [mapPath, "PBS/pokemon.txt"]) {
    assert.equal(await sha(join(root, relative)), await sha(join(reopened, relative)),
      "Edited file was not preserved after reimport");
  }
  assert.equal(await sha(input), originalHash, "Original private ZIP was modified");
  assert.deepEqual(pageErrors, [], "React page threw uncaught errors");
  result.stages.nativeReimport = "passed";
  result.exportedZipSha256 = await sha(exported);
  result.changedPaths = [mapPath, "PBS/pokemon.txt"];
  result.status = "React map/event/PBS UI → Rust save → ZIP export → independent verification → reimport passed";
  await page.screenshot({ path: join(evidence, "private-react-export-complete.png"), fullPage: true });
} catch (error) {
  result.failedStage = stage;
  if (stage === "React PBS editing and save") result.failedSubstage = pbsSubstage;
  // Never persist source paths, dialogue, PBS content or private asset names.
  result.failureCategory = error?.name || "Error";
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server?.pid && server.exitCode === null) {
    try { if (process.platform !== "win32") process.kill(-server.pid, "SIGTERM"); else server.kill("SIGTERM"); }
    catch { /* already exited */ }
  }
  await sleep(500);
  rmSync(temp, { recursive: true, force: true });
  writeFileSync(join(evidence, "private-react-receipt.json"), JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(result));
}
