// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RpgEvent } from "../src/types";
import { EventEditor } from "../src/components/EventEditor/EventEditor";
import { ProjectSaveProvider, useProjectSave } from "../src/context/ProjectSaveContext";

const native = vi.hoisted(() => ({
  loadEvent: vi.fn(),
  saveEvent: vi.fn(),
  loadSystemData: vi.fn(),
  listAssetFiles: vi.fn(),
  previewAudio: vi.fn(),
  stopAudio: vi.fn(),
  isAudioPlaying: vi.fn(),
}));

vi.mock("../src/services/tauriApi", () => native);

const projectPath = "/synthetic-rights-cleared-project";
const defaultInnerWidth = window.innerWidth;

function importedEvent(): RpgEvent {
  return {
    id: 7,
    name: "Synthetic Guide",
    x: 1,
    y: 1,
    pages: [{
      source_index: 0,
      condition: {
        switch1_valid: false,
        switch2_valid: false,
        variable_valid: false,
        self_switch_valid: false,
        switch1_id: 1,
        switch2_id: 1,
        variable_id: 1,
        variable_value: 0,
        self_switch_ch: "A",
      },
      graphic: {
        tile_id: 0,
        character_name: "",
        character_hue: 0,
        direction: 2,
        pattern: 0,
        opacity: 255,
        blend_type: 0,
      },
      move_type: 0,
      move_speed: 3,
      move_frequency: 3,
      move_route: { repeat: true, skippable: false, list: [{ code: 0, parameters: [] }] },
      walk_anime: true,
      step_anime: false,
      direction_fix: false,
      through: false,
      always_on_top: false,
      trigger: 0,
      list: [
        { code: 101, indent: 0, parameters: ["", 0, 0, 2], source_index: 0 },
        { code: 401, indent: 0, parameters: ["Original dialogue"], source_index: 1 },
        { code: 0, indent: 0, parameters: [], source_index: 2 },
      ],
    }],
  };
}

let diskEvent: RpgEvent;

function SaveAllControls() {
  const { saveAll } = useProjectSave();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button onClick={() => {
        setSaved(false);
        setError(null);
        void saveAll().then(
          () => setSaved(true),
          (reason: unknown) => setError(String(reason)),
        );
      }}>
        Save All
      </button>
      {saved && <div role="status">Save All succeeded</div>}
      {error && <div role="alert">Save All failed: {error}</div>}
    </>
  );
}

function RenderedProject() {
  const [eventOpen, setEventOpen] = useState(true);

  return (
    <>
      <SaveAllControls />
      {eventOpen ? (
        <EventEditor
          projectPath={projectPath}
          mapId={1}
          eventId={7}
          eventName="Synthetic Guide"
          onClose={() => setEventOpen(false)}
        />
      ) : (
        <button onClick={() => setEventOpen(true)}>Open event</button>
      )}
    </>
  );
}

function renderProject() {
  return render(
    <ProjectSaveProvider>
      <RenderedProject />
    </ProjectSaveProvider>,
  );
}

beforeEach(() => {
  diskEvent = importedEvent();
  native.loadEvent.mockImplementation(async () => structuredClone(diskEvent));
  native.saveEvent.mockImplementation(async (_path: string, _mapId: number, event: RpgEvent) => {
    const textCommand = event.pages[0]?.list.find((command) => command.code === 401);
    if (!textCommand || textCommand.source_index !== 1) {
      throw new Error("Ambiguous same-code replacement; save aborted");
    }
    diskEvent = structuredClone(event);
  });
  native.loadSystemData.mockResolvedValue({ switches: [], variables: [] });
  native.listAssetFiles.mockResolvedValue([]);
  native.previewAudio.mockResolvedValue(undefined);
  native.stopAudio.mockResolvedValue(undefined);
  native.isAudioPlaying.mockResolvedValue(false);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", { configurable: true, value: defaultInnerWidth });
  vi.clearAllMocks();
});

describe("rendered event editor Save All integration", () => {
  it("edits dialogue on another event page and persists only that page through Save All", async () => {
    const firstPage = structuredClone(diskEvent.pages[0]);
    const secondPage = structuredClone(firstPage);
    secondPage.list = [
      { code: 101, indent: 0, parameters: ["", 0, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["Second page dialogue"], source_index: 1 },
      { code: 0, indent: 0, parameters: [], source_index: 2 },
    ];
    diskEvent.pages.push(secondPage);
    renderProject();

    const secondPageTab = await screen.findByRole("button", { name: "Event page 2" });
    expect(screen.getByRole("button", { name: "Event page 1" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(secondPageTab);
    expect(secondPageTab.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(await screen.findByText("Second page dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));

    const editor = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    fireEvent.change(editor, { target: { value: "Updated second page dialogue" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Updated second page dialogue");
    fireEvent.click(screen.getByRole("button", { name: "Undo event edit" }));
    await screen.findByText("Second page dialogue");
    fireEvent.click(screen.getByRole("button", { name: "Redo event edit" }));
    await screen.findByText("Updated second page dialogue");
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");

    expect(diskEvent.pages[0]).toEqual(firstPage);
    expect(diskEvent.pages[1].list[1].parameters[0]).toBe("Updated second page dialogue");
    expect(diskEvent.pages[1].list.map((command) => command.source_index)).toEqual([0, 1, 2]);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    fireEvent.click(await screen.findByRole("button", { name: "Event page 2" }));
    await screen.findByText("Updated second page dialogue");
    expect(native.loadEvent).toHaveBeenCalledTimes(2);
  });

  it("starts event properties collapsed on narrow screens while keeping commands available", async () => {
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
    renderProject();

    const propertiesToggle = await screen.findByRole("button", { name: "Show event properties" });
    expect(propertiesToggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByText(/^Event Commands/)).toBeTruthy();
  });

  it("opens the visible dialogue editor from a single touch-sized row action and persists with Save All", async () => {
    renderProject();

    fireEvent.click(await screen.findByRole("button", { name: "Edit dialogue" }));
    const dialogueEditor = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    expect(dialogueEditor).toBeTruthy();
    expect((dialogueEditor as HTMLTextAreaElement).value).toBe("Original dialogue");

    fireEvent.change(dialogueEditor, { target: { value: "Edited by direct touch action" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Edited by direct touch action");
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));

    await screen.findByText("Save All succeeded");
    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Edited by direct touch action");
  });

  it("confirms dialogue with OK, saves all, and reloads the still-open event", async () => {
    renderProject();

    expect(await screen.findByRole("button", { name: "Undo event edit" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Redo event edit" })).toBeTruthy();
    fireEvent.click(await screen.findByText("Original dialogue"));
    const edit = screen.getByRole("button", { name: "Edit" });
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(edit);
    const editor = await screen.findByDisplayValue("Original dialogue");
    expect(editor.getAttribute("autocorrect")).toBe("off");
    expect(editor.getAttribute("spellcheck")).toBe("false");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    expect(screen.getByDisplayValue("Edited dialogue")).toBeTruthy();
    expect(native.saveEvent).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Edited dialogue");
    expect(screen.getByRole("button", { name: "Save & close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open event" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    const submitted = native.saveEvent.mock.calls[0][2] as RpgEvent;
    expect(submitted.pages[0].list[0].parameters).toEqual(["", 0, 0, 2]);
    expect(submitted.pages[0].list[0].source_index).toBe(0);
    expect(submitted.pages[0].list[1].parameters[0]).toBe("Edited dialogue");
    expect(submitted.pages[0].list[1].source_index).toBe(1);
    expect(native.loadEvent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    await screen.findByText("Edited dialogue");

    expect(native.loadEvent).toHaveBeenCalledTimes(2);
    expect(diskEvent.pages[0].list[0].parameters).toEqual(["", 0, 0, 2]);
    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Edited dialogue");
    expect(diskEvent.pages[0].list[0].source_index).toBe(0);
    expect(diskEvent.pages[0].list[1].source_index).toBe(1);
  });

  it("inserts and edits a Show Text command through the mobile picker and Save All", async () => {
    renderProject();
    await screen.findByText("Original dialogue");

    fireEvent.click(screen.getByRole("button", { name: /\+ Insert/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search event commands" }), {
      target: { value: "Show Text" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Show Text/ }));
    expect(screen.queryByRole("dialog", { name: "Insert Command" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const dialogueEditor = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    fireEvent.change(dialogueEditor, { target: { value: "Newly inserted dialogue\nSecond line" } });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Newly inserted dialogue");

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByText("Save All succeeded");
    const savedCommands = diskEvent.pages[0].list;
    expect(savedCommands.map((command) => command.code)).toEqual([101, 401, 101, 401, 401, 0]);
    expect(savedCommands[3].parameters[0]).toBe("Newly inserted dialogue");
    expect(savedCommands[4].parameters[0]).toBe("Second line");

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    await screen.findByText("Second line");
  });

  it("does not apply editor shortcuts while typing in the command picker", async () => {
    renderProject();
    await screen.findByText("Original dialogue");
    fireEvent.click(screen.getByText("Original dialogue"));
    fireEvent.keyDown(window, { key: "c", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: /\+ Insert/ }));
    const search = screen.getByRole("textbox", { name: "Search event commands" });
    fireEvent.keyDown(search, { key: "v", ctrlKey: true });
    fireEvent.click(screen.getByRole("button", { name: "Close command picker" }));

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByText("Save All succeeded");
    expect(native.saveEvent).not.toHaveBeenCalled();
    expect(diskEvent.pages[0].list.map((command) => command.code)).toEqual([101, 401, 0]);
  });

  it("copies and duplicates whole Show Text blocks without reusing source indices", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["Portrait", 1, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["First original line"], source_index: 1 },
      { code: 401, indent: 0, parameters: ["Second original line"], source_index: 2 },
      { code: 0, indent: 0, parameters: [], source_index: 3 },
    ];
    renderProject();
    await screen.findByText("Second original line");

    const secondLine = screen.getByText("Second original line");
    fireEvent.click(secondLine);
    fireEvent.keyDown(secondLine, { key: "c", ctrlKey: true });
    fireEvent.keyDown(secondLine, { key: "v", ctrlKey: true });
    fireEvent.keyDown(secondLine, { key: "d", ctrlKey: true });

    expect(screen.getAllByText("First original line")).toHaveLength(3);
    expect(screen.getAllByText("Second original line")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByText("Save All succeeded");

    const commands = diskEvent.pages[0].list;
    expect(commands.map((command) => command.code)).toEqual([
      101, 401, 401,
      101, 401, 401,
      101, 401, 401,
      0,
    ]);
    expect(commands.slice(3, 9).map((command) => command.parameters[0])).toEqual([
      "Portrait", "First original line", "Second original line",
      "Portrait", "First original line", "Second original line",
    ]);
    expect(commands.slice(3, 9).every((command) => command.source_index === undefined)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    await screen.findAllByText("Second original line");
    expect(native.loadEvent).toHaveBeenCalledTimes(2);
    expect(diskEvent.pages[0].list.map((command) => command.code)).toEqual(commands.map((command) => command.code));
  });

  it("supports touch copy, paste, and duplicate while keeping the page terminator last", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["Portrait", 1, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["First original line"], source_index: 1 },
      { code: 401, indent: 0, parameters: ["Second original line"], source_index: 2 },
      { code: 0, indent: 0, parameters: [], source_index: 3 },
    ];
    const secondPage = structuredClone(diskEvent.pages[0]);
    secondPage.list = [
      { code: 101, indent: 0, parameters: ["", 0, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["Other page dialogue"], source_index: 1 },
      { code: 0, indent: 0, parameters: [], source_index: 2 },
    ];
    diskEvent.pages.push(secondPage);
    renderProject();
    const secondLine = await screen.findByText("Second original line");
    fireEvent.click(secondLine);
    fireEvent.click(screen.getByRole("button", { name: "Copy selected command block" }));
    fireEvent.click(screen.getByRole("button", { name: "Event page 2" }));
    await screen.findByText("Other page dialogue");
    fireEvent.click(screen.getByRole("button", { name: "Paste command block" }));
    fireEvent.click(screen.getByRole("button", { name: "Duplicate selected command block" }));
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByText("Save All succeeded");

    expect(diskEvent.pages[0].list.map((command) => command.parameters[0])).toEqual([
      "Portrait", "First original line", "Second original line", undefined,
    ]);
    const savedCommands = diskEvent.pages[1].list;
    expect(savedCommands.map((command) => command.code)).toEqual([
      101, 401,
      101, 401, 401,
      101, 401, 401,
      0,
    ]);
    expect(savedCommands.at(-1)?.code).toBe(0);
    expect(savedCommands.slice(2, 8).every((command) => command.source_index === undefined)).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    fireEvent.click(await screen.findByRole("button", { name: "Event page 2" }));
    expect((await screen.findAllByText("First original line")).length).toBe(2);
    expect(native.loadEvent).toHaveBeenCalledTimes(2);
  });

  it("moves complete dialogue blocks with touch controls and persists their source mapping", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["First portrait", 1, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["First dialogue"], source_index: 1 },
      { code: 101, indent: 0, parameters: ["Second portrait", 1, 0, 2], source_index: 2 },
      { code: 401, indent: 0, parameters: ["Second dialogue"], source_index: 3 },
      { code: 0, indent: 0, parameters: [], source_index: 4 },
    ];
    native.saveEvent.mockImplementationOnce(async (_path: string, _mapId: number, event: RpgEvent) => {
      diskEvent = structuredClone(event);
    });
    renderProject();
    fireEvent.click(await screen.findByText("Second dialogue"));
    const moveUp = screen.getByRole("button", { name: "Move selected command up" });
    const moveDown = screen.getByRole("button", { name: "Move selected command down" });
    expect((moveUp as HTMLButtonElement).disabled).toBe(false);
    expect((moveDown as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(moveUp);
    expect((screen.getByRole("button", { name: "Move selected command up" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Move selected command down" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByText("Save All succeeded");

    const savedCommands = diskEvent.pages[0].list;
    expect(savedCommands.map((command) => command.parameters[0])).toEqual([
      "Second portrait", "Second dialogue",
      "First portrait", "First dialogue",
      undefined,
    ]);
    expect(savedCommands.map((command) => command.source_index)).toEqual([2, 3, 0, 1, 4]);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    await screen.findByText("Second dialogue");
    await screen.findByText("First dialogue");
    expect(native.loadEvent).toHaveBeenCalledTimes(2);
  });

  it("shows every Show Text line and discards an unconfirmed draft with Escape", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["Face", 1, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["A long opening dialogue line for a narrow phone screen"], source_index: 1 },
      { code: 401, indent: 0, parameters: ["A second dialogue line that must remain visible"], source_index: 2 },
      { code: 401, indent: 0, parameters: ["The final dialogue line is preserved too"], source_index: 3 },
      { code: 0, indent: 0, parameters: [], source_index: 4 },
    ];
    renderProject();

    fireEvent.click(await screen.findByText("A long opening dialogue line for a narrow phone screen"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    expect(textarea.getAttribute("autocorrect")).toBe("off");
    expect(textarea.getAttribute("spellcheck")).toBe("false");
    expect((textarea as HTMLTextAreaElement).value).toBe([
      "A long opening dialogue line for a narrow phone screen",
      "A second dialogue line that must remain visible",
      "The final dialogue line is preserved too",
    ].join("\n"));

    fireEvent.change(textarea, {
      target: { value: "Edited opening line\nEdited middle line\nEdited final line" },
    });
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Show Text dialogue lines" })).toBeNull();
    await screen.findByText("A second dialogue line that must remain visible");
    await screen.findByText("The final dialogue line is preserved too");
    expect(screen.queryByText("Edited middle line")).toBeNull();
    expect(diskEvent.pages[0].list.map((command) => command.parameters[0])).toContain(
      "A second dialogue line that must remain visible",
    );
    expect(native.saveEvent).not.toHaveBeenCalled();
    expect(diskEvent.pages[0].list.map((command) => command.code)).toEqual([101, 401, 401, 401, 0]);
    expect(diskEvent.pages[0].list[0].parameters).toEqual(["Face", 1, 0, 2]);
    expect(diskEvent.pages[0].list.slice(1, 4).map((command) => command.parameters[0])).toEqual([
      "A long opening dialogue line for a narrow phone screen",
      "A second dialogue line that must remain visible",
      "The final dialogue line is preserved too",
    ]);
  });

  it("places one OK confirmation above the multiline field and returns to the command list", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["Face", 1, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["Dialogue before edit"], source_index: 1 },
      { code: 0, indent: 0, parameters: [], source_index: 2 },
    ];
    renderProject();

    fireEvent.click(await screen.findByText("Dialogue before edit"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    fireEvent.change(textarea, { target: { value: "Edited from Android" } });
    const okButton = screen.getByRole("button", { name: "OK" });
    expect(textarea.compareDocumentPosition(okButton) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "OK" })).toHaveLength(1);
    fireEvent.click(okButton);

    expect(screen.queryByRole("textbox", { name: "Show Text dialogue lines" })).toBeNull();
    await screen.findByText("Edited from Android");
    expect(screen.getByRole("button", { name: "Save & close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open event" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");
    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Edited from Android");
  });

  it("collapses mobile event properties without interrupting dialogue edits or Save All", async () => {
    renderProject();

    const propertiesToggle = await screen.findByRole("button", { name: "Hide event properties" });
    const properties = document.getElementById("event-page-properties-content");
    expect(properties).toBeTruthy();
    expect(properties?.hidden).toBe(false);
    fireEvent.click(propertiesToggle);
    expect(screen.getByRole("button", { name: "Show event properties" }).getAttribute("aria-expanded")).toBe("false");
    expect(properties?.hidden).toBe(true);

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    fireEvent.change(await screen.findByDisplayValue("Original dialogue"), {
      target: { value: "Edited while properties collapsed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Edited while properties collapsed");
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");

    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Edited while properties collapsed");
    expect(screen.getByRole("button", { name: "Show event properties" })).toBeTruthy();
  });

  it("discards a Show Text draft with Cancel without persisting it", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["", 0, 0, 2], source_index: 0 },
      { code: 401, indent: 0, parameters: ["Original dialogue"], source_index: 1 },
      { code: 0, indent: 0, parameters: [], source_index: 2 },
    ];
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const input = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(input, { target: { value: "Edited single-line dialogue" } });
    fireEvent.click(within(
      screen.getByRole("group", { name: "Dialogue edit actions" }),
    ).getByRole("button", { name: "Cancel" }));

    await screen.findByText("Original dialogue");
    expect(screen.queryByText("Edited single-line dialogue")).toBeNull();
    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Original dialogue");
    expect(native.saveEvent).not.toHaveBeenCalled();
  });

  it("saves the edited event immediately with Save & close, leaving nothing for Save All", async () => {
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Edited dialogue");

    fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    await screen.findByRole("button", { name: "Open event" });

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    expect(diskEvent.pages[0].list[0].parameters).toEqual(["", 0, 0, 2]);
    expect(diskEvent.pages[0].list[1].parameters[0]).toBe("Edited dialogue");
    expect(screen.queryByRole("button", { name: "Save & close" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");
    expect(native.saveEvent).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open when Save & close cannot persist the event", async () => {
    native.saveEvent.mockRejectedValueOnce(new Error("synthetic write failure"));
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText("Edited dialogue");

    fireEvent.click(screen.getByRole("button", { name: "Save & close" }));
    await screen.findByText(/Save failed: Error: synthetic write failure/);

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Save & close" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Open event" })).toBeNull();
  });

  it("closes the reopened event editor when Escape is dispatched", async () => {
    renderProject();

    fireEvent.keyDown(window, { key: "Escape" });

    await screen.findByRole("button", { name: "Open event" });
    expect(native.saveEvent).not.toHaveBeenCalled();
  });

  it("rejects a rendered same-code replacement and shows failure without success", async () => {
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "+ Insert" }));
    fireEvent.change(screen.getByPlaceholderText("Search commands..."), {
      target: { value: "Show Text" },
    });
    fireEvent.click(await screen.findByText("Show Text", {
      selector: ".command-picker-item-name",
    }));

    fireEvent.click(screen.getByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByText("Show Text");
    const originalDiskEvent = structuredClone(diskEvent);

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await waitFor(() => {
      const alerts = screen.getAllByRole("alert").map((alert) => alert.textContent ?? "");
      expect(alerts.some((alert) => alert.includes("Ambiguous same-code replacement"))).toBe(true);
      expect(alerts.some((alert) => alert.includes("Save failed:"))).toBe(true);
      expect(alerts.some((alert) => alert.includes("Save All failed:"))).toBe(true);
    });

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    const submitted = native.saveEvent.mock.calls[0][2] as RpgEvent;
    const replacement = submitted.pages[0].list.find((command) => command.code === 101);
    expect(replacement?.source_index).toBeUndefined();
    expect(screen.queryByRole("status")).toBeNull();
    expect(diskEvent).toEqual(originalDiskEvent);
  });
});
