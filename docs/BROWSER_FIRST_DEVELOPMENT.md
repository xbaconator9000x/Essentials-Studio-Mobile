# Browser-first Essentials Studio development (experimental)

Use the **existing Rust RMXP Marshal/PBS backend**, not a second browser serializer. This local browser mode is for faster map/event/PBS editing tests without Android emulation. It is not a substitute for Android SAF, desktop reopening or JoiPlay/NaviaXP acceptance.

## Run

Install Node dependencies with `npm ci` and Rust with Cargo, then use a **disposable, rights-cleared** RPG Maker XP project folder or ZIP:

```sh
npm run dev:web -- /absolute/path/to/disposable/RMXP-project
# Or safely import a ZIP into a NEW persistent editable working copy:
npm run dev:web -- /absolute/path/to/rights-cleared-project.zip
```

When launched from a ZIP, the existing native ZIP importer enforces entry limits, safe paths, portable names, duplicate detection and bounded project-root discovery. It creates a **new editable directory alongside the source ZIP** (or at `ESSENTIALS_BROWSER_WORKSPACE` if set), never overwrites the original and never deletes the working copy on exit. The terminal prints its exact path. To produce a complete new ZIP after saving map/event/PBS edits:

```sh
npm run archive:web -- export /absolute/path/to/editable/project /absolute/path/to/edited-project.zip
python3 scripts/verify_project_roundtrip.py original.zip edited-project.zip \\
  --allow-changed Data/Map001.rxdata --allow-changed PBS/pokemon.txt
```

The output must not already exist or be inside the project. Export is staged and published without clobbering existing files. This is a **local CLI export**, not a browser download button or Android SAF proof.

Open `http://127.0.0.1:5173` on the same computer and choose Open Project. The backend-selected root opens automatically. The Rust process binds **127.0.0.1:5174 only**. Vite binds **127.0.0.1:5173 only** and proxies `/api/browser/invoke` with an ephemeral token that is never bundled into the React client. Requests must pass exact origin, host, content-type, client-header and token checks. The backend only accepts the selected canonical project root and confines map/PBS/graphics files to it.

Supported vertical slice: read map/tileset/system/event/PBS data, edit and save existing three-layer maps, existing events and existing PBS files, and read project images. Selected read-only script/database queries work. Unsupported operations fail explicitly instead of pretending to save.

**Not supported yet in the browser UI:** ZIP file picker/download (use the native CLI ZIP import/export above), creating or deleting maps/events, writing scripts/database, audio and native document pickers. These continue through the existing Tauri APK. Browser mode does not launch RPG Maker XP games.

Run `node --experimental-strip-types --test tests/browserTransport.test.mjs` for transport regressions. Native Rust tests and frontend build must pass before merging the browser bridge. Use `scripts/verify_project_roundtrip.py` on separately exported ZIPs; this browser-only slice does not assert that full Shattered v21.1 desktop/game runtime compatibility is complete.

Security: development-only local service. Never bind it to 0.0.0.0, reverse-proxy it publicly, or use a commercial project as a public fixture. No public APK release until upstream licensing is resolved.

## Verification state

Local Node 22 browser transport tests passed (3/3) on 2026-11-02. The native ZIP CLI and HTTP smoke workflow independently compare archive members after map/event/PBS edits; a real interactive React browser session and actual Shattered v21.1 compatibility remain separate gates. Do not equate a successful TypeScript or Android compilation with that runtime acceptance.
