#!/usr/bin/env node
/**
 * Local-only browser editor: same Rust Marshal/PBS commands as Tauri,
 * served via a token-protected loopback bridge behind Vite's dev proxy.
 * Requires a disposable, already-extracted RMXP project directory.
 */
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2] || process.env.ESSENTIALS_BROWSER_PROJECT_ROOT;
if (!input) {
  console.error("Usage: npm run dev:web -- /absolute/path/to/extracted/RMXP-project");
  process.exit(2);
}
const projectRoot = resolve(input);
if (!existsSync(projectRoot) || !statSync(projectRoot).isDirectory()) {
  console.error("Selected project root is not an existing directory:", projectRoot);
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
