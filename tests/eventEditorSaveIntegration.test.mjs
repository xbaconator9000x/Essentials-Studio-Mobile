import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { updateEventCommandParam } from "../src/services/eventEditorMutation.ts";
import { createEventProjectBridge } from "../src/services/eventProjectBridge.ts";
import { saveEventSnapshot } from "../src/services/eventSaveGuards.ts";
import { saveSequentially } from "../src/services/saveBatch.ts";
import { serializeProjectOperation, shouldSerializeProjectCommand } from "../src/services/projectMutationQueue.ts";

const root = new URL("../", import.meta.url);
const projectPath = "/synthetic-rights-cleared-project";

function importedEvent() {
  return {
    id: 7,
    name: "Synthetic Guide",
    x: 1,
    y: 1,
    pages: [{
      source_index: 0,
      condition: {},
      list: [
        { code: 101, indent: 0, parameters: ["Original dialogue"], source_index: 0 },
        { code: 0, indent: 0, parameters: [], source_index: 1 },
      ],
    }],
  };
}

test("EventEditor edit reaches Save All and the project bridge with origin intact", async () => {
  const eventEditorSource = await readFile(new URL("src/components/EventEditor/EventEditor.tsx", root), "utf8");
  const appSource = await readFile(new URL("src/App.tsx", root), "utf8");
  const saveContextSource = await readFile(new URL("src/context/ProjectSaveContext.tsx", root), "utf8");
  const tauriApiSource = await readFile(new URL("src/services/tauriApi.ts", root), "utf8");
  assert.match(eventEditorSource, /updateEventCommandParam\(p, index, paramIndex, value\)/);
  assert.match(eventEditorSource, /saveEventSnapshot\([\s\S]*?saveEvent\(projectPath, mapId, snapshot\)/);
  assert.match(eventEditorSource, /useEditorRegistration\([\s\S]*?saveForProject/);
  assert.match(appSource, /<EventEditor[\s\S]*?projectPath=\{project\.path\}[\s\S]*?eventId=\{editingEvent\.eventId\}/);
  assert.match(appSource, /await saveAll\(\)/);
  assert.match(appSource, /const confirmProjectSwitch = useCallback[\s\S]*?await saveAllWithLock\(\)/);
  assert.match(appSource, /Close project-bound editors[\s\S]*?setEditingEvent\(null\)/);
  assert.match(saveContextSource, /await saveSequentially\(jobs\)/);
  assert.match(tauriApiSource, /createEventProjectBridge\(invoke\)/);
  assert.match(tauriApiSource, /eventProjectBridge\.loadEvent\(projectPath, mapId, eventId\)/);
  assert.match(tauriApiSource, /eventProjectBridge\.saveEvent\(projectPath, mapId, event\)/);

  const original = importedEvent();
  let visible = structuredClone(original);
  let rawCommand = {
    code: 101,
    parameters: ["Original dialogue"],
    opaqueMarshalIvar: "preserve-me",
  };
  const bridgeCalls = [];
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        bridgeCalls.push(command);
        if (command === "load_event") return structuredClone(visible);
        if (command === "save_event") {
          const edited = args.event.pages[0].list[0];
          if (edited.source_index !== 0 || edited.code !== rawCommand.code) {
            throw new Error("Ambiguous event command replacement; save aborted");
          }
          rawCommand = {
            ...rawCommand,
            parameters: [...edited.parameters],
          };
          visible = structuredClone(args.event);
          return null;
        }
        throw new Error(`Unexpected project bridge command: ${command}`);
      },
    },
  };

  const projectInvoke = (command, args) => {
    const operation = () => window.__TAURI_INTERNALS__.invoke(command, args);
    return shouldSerializeProjectCommand(command, args)
      ? serializeProjectOperation(args.projectPath, operation)
      : operation();
  };
  const { loadEvent, saveEvent } = createEventProjectBridge(projectInvoke);
  let editorEvent = await loadEvent(projectPath, 1, 7);
  const edited = {
    ...editorEvent,
    pages: [
      updateEventCommandParam(editorEvent.pages[0], 0, 0, "Edited dialogue"),
    ],
  };
  let revision = 1;
  await saveSequentially([{
    id: `event-${projectPath}-1-7`,
    save: async () => {
      const current = await saveEventSnapshot(
        edited,
        revision,
        () => revision,
        (snapshot) => saveEvent(projectPath, 1, snapshot),
      );
      assert.equal(current, true);
    },
  }]);

  editorEvent = null;
  assert.equal(editorEvent, null, "project close unmounts the event editor");
  const reopened = await loadEvent(projectPath, 1, 7);
  assert.equal(reopened.pages[0].list[0].parameters[0], "Edited dialogue");
  assert.equal(reopened.pages[0].list[0].source_index, 0);
  assert.equal(rawCommand.opaqueMarshalIvar, "preserve-me");
  assert.deepEqual(bridgeCalls, ["load_event", "save_event", "load_event"]);

  const beforeRejectedReplacement = structuredClone(rawCommand);
  const replacement = structuredClone(reopened);
  replacement.pages[0].list[0] = {
    code: 101,
    indent: 0,
    parameters: ["Replacement with the same code"],
  };
  await assert.rejects(saveEvent(projectPath, 1, replacement), /Ambiguous event command replacement/);
  assert.deepEqual(rawCommand, beforeRejectedReplacement);
});
