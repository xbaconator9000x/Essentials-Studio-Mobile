#!/usr/bin/env node
/**
 * Local-only browser editor: same Rust Marshal/PBS commands as Tauri,
 * served via a token-protected loopback bridge behind Vite's dev proxy.
 * Requires a disposable, already-extracted RMXP project directory.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, realpathSync, statSync } from "node:fs";
import { basename, dirname, extname, resolve } from "node:path";

const input = process.argv[2] || process.env.ESSENTIALS_BROWSER_PROJECT_ROOT;
if (!input) {
  console.error("Usage: npm run dev:web -- /absolute/path/to/extracted/RMXP-project");
  process.exit(2);
}
const selected = resolve(input);
if (!existsSync(selected)) {
  console.error("Selected project folder or ZIP does not exist:", selected);
  process.exit(2);
}
let projectRoot;
if (statSync(selected).isFile() && extname(selected).toLowerCase() === ".zip") {
  // Never edit the original ZIP. Extract into a new, persistent working copy
  // through the exact same native-safe ZIP importer used by Android.
  const name = basename(selected, extname(selected)).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 48) || "Essentials";
  const workspace = process.env.ESSENTIALS_BROWSER_WORKSPACE
    ? resolve(process.env.ESSENTIALS_BROWSER_WORKSPACE)
    : resolve(dirname(selected), `${name}-browser-edit-${Date.now()}-${randomBytes(3).toString("hex")}`);
  const result = spawnSync("cargo", [
    "run", "--quiet", "--manifest-path", "src-tauri/Cargo.toml",
    "--bin", "browser_archive", "--", "import", selected, workspace,
  ], { encoding: "utf8", timeout: 300_000 });
  if (result.error || result.status !== 0) {
    console.error("Safe browser ZIP import failed:", result.stderr || result.error?.message || result.status);
    process.exit(1);
  }
  projectRoot = realpathSync(result.stdout.trim());
  console.log("Editable project copy:", projectRoot);
  console.log("The original ZIP is untouched. This working copy remains on disk after exit.");
  console.log("To export: npm run archive:web -- export", JSON.stringify(projectRoot), JSON.stringify(resolve(dirname(workspace), name + "-edited.zip")));
} else if (statSync(selected).isDirectory()) {
  projectRoot = realpathSync(selected);
} else {
  console.error("Select an extracted project directory or .zip file:", selected);
  process.exit(2);
}
const token = randomBytes(32).toString("hex");
const env = {
  ...process.env,
  ESSENTIALS_BROWSER_TOKEN: token,
  ESSENTIALS_BROWSER_PROJECT_ROOT: projectRoot,
  VITE_BROWSER_BACKEND_URL: "/api/browser/",
};
const children = [];
function start(program, args) {
  const child = spawn(program, args, { env, stdio: "inherit", shell: false });
  children.push(child);
  child.on("error", error => {
    console.error("Could not start " + program + ": " + error.message);
    stop(1);
  });
  child.on("exit", code => {
    if (code !== 0) {
      console.error(program + " exited with status " + code);
      stop(code || 1);
    }
  });
  return child;
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) if (!child.killed) child.kill("SIGTERM");
  process.exitCode = code;
}
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log("Browser editor: http://127.0.0.1:5173");
console.log("Project root:", projectRoot);
console.log("Native Rust bridge may need time to compile; no public network binding.");
start("cargo", ["run", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "browser_bridge"]);
start("npm", ["run", "dev", "--", "--host", "127.0.0.1"]);
