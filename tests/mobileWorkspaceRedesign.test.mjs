import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const load = name => readFileSync(new URL(name, import.meta.url), "utf8");
const css = load("../src/mobileWorkspaceRedesign.css");
const app = load("../src/App.tsx");
const editor = load("../src/components/PbsEntityEditor/PbsEntityEditor.tsx");
const list = load("../src/components/PbsEntityEditor/shared/EntityListPanel.tsx");

test("the mobile workspace has one project identity and dismissible overlay receipts", () => {
  assert.match(app, /import "\.\/mobileCompact\.css";\s*import "\.\/mobileWorkspaceRedesign\.css";/);
  assert.match(app, /className="app app--workspace" aria-busy=/);
  assert.match(css, /\.app--workspace > \.app-titlebar \{ display: none; \}/);
  assert.match(css, /\.app--workspace \.app-mobile-operation-feedback \{\s*position: fixed;/);
  assert.match(app, /onSaveAll=\{\(\) => void handleSaveAll\(\)\}/);
  assert.match(app, /onExportZip=\{\(\) => void handleExportProjectZip\(\)\}/);
});
test("the PBS mobile record chooser uses a full-width drawer and keeps all sections mounted", () => {
  assert.match(editor, /className="pbs-mobile-category-picker" aria-label="PBS category"/);
  assert.match(editor, /setRecordsOpen\(open => !open\)/);
  assert.match(editor, /className="pbs-entity-panels" id="pbs-mobile-record-list"/);
  assert.match(editor, /target\.closest\("\.pbs-entity-list \[role='option'\]"\)/);
  assert.match(editor, /Section panels — all always mounted/);
  assert.match(list, /className="pbs-entity-list"/);
  assert.match(css, /\.pbs-entity-sidebar \{ display: none; \}/);
  assert.match(css, /\.pbs-entity-panels \.pbs-entity-list \{ display: none !important; \}/);
  assert.match(css, /\.pbs-entity-editor\.records-open \.pbs-entity-panels \.pbs-entity-list \{/);
});
test("phone Pokémon forms use the whole available viewport without scaling source graphics", () => {
  assert.match(css, /\.pbs-pokemon-panel, \.pbs-pokemon-detail \{ width: 100%; min-width: 0; \}/);
  assert.match(css, /\.pbs-pokemon-sprite-header img \{/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(css, /transform:\s*scale\(/);
  assert.match(css, /@media \(max-width: 900px\)/);
});
