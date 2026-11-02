#!/usr/bin/env node
/**
 * Actual React/Chromium -> Rust map and PBS edit/export/reimport acceptance.
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
  const mapId = Number(project.edit_map_id);
  assert.ok(Number.isInteger(mapId) && mapId > 0 && mapId <= 999, "Invalid initial map ID");
  const before = await invoke("load_map", { projectPath: root, mapId });
  assert.ok(before.width > 0 && before.height > 0 && before.tiles.length === before.width * before.height * 3,
    "Invalid initial three-layer map");
  await page.locator(".map-editor-canvas").waitFor({ timeout: 120_000 });
  await page.screenshot({ path: join(evidence, "private-react-map-open.png"), fullPage: true });
  result.stages.reactProjectOpen = "passed";

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
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll("button")].find(b => b.textContent?.trim() === "Save All");
    return button?.disabled === true;
  }, null, { timeout: 60_000 });
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

  stage = "React PBS editing and save";
  const pbsBefore = await invoke("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  const firstName = pbsBefore[0]?.fields?.find(field => field.key === "Name")?.value;
  assert.ok(typeof firstName === "string" && firstName.length > 0, "No first Pokémon Name field");
  await page.getByRole("button", { name: "PBS Data", exact: true }).click();
  const editor = page.locator(".pbs-entity-editor");
  await editor.waitFor({ timeout: 90_000 });
  const inputs = editor.locator(".pbs-entity-panels > div:first-child input");
  await page.waitForFunction(name =>
    [...document.querySelectorAll(".pbs-entity-panels > div:first-child input")]
      .some(input => input.value === name), firstName, { timeout: 90_000 });
  const index = await inputs.evaluateAll((elements, name) =>
    elements.findIndex(element => element.value === name), firstName);
  assert.ok(index >= 0, "React PBS name field is not editable");
  const replacement = "PrivateUiRoundtripProbe";
  assert.notEqual(firstName, replacement, "PBS probe must change a value");
  await inputs.nth(index).fill(replacement);
  await editor.getByText("Unsaved changes").waitFor({ timeout: 30_000 });
  await editor.getByRole("button", { name: "Apply", exact: true }).click();
  await editor.getByText("Unsaved changes").waitFor({ state: "hidden", timeout: 90_000 });
  const pbsAfter = await invoke("load_pbs_file", { projectPath: root, filename: "pokemon.txt" });
  assert.equal(pbsAfter[0]?.fields?.find(field => field.key === "Name")?.value, replacement,
    "React PBS save did not persist through native backend");
  await editor.getByRole("button", { name: "OK", exact: true }).click();
  await editor.waitFor({ state: "hidden", timeout: 30_000 });
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
  result.status = "React map/PBS UI → Rust save → ZIP export → independent verification → reimport passed";
  await page.screenshot({ path: join(evidence, "private-react-export-complete.png"), fullPage: true });
} catch (error) {
  result.failedStage = stage;
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
