// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
        { code: 101, indent: 0, parameters: ["Original dialogue"], source_index: 0 },
        { code: 0, indent: 0, parameters: [], source_index: 1 },
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
    const textCommand = event.pages[0]?.list.find((command) => command.code === 101);
    if (!textCommand || textCommand.source_index !== 0) {
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
  vi.clearAllMocks();
});

describe("rendered event editor Save All integration", () => {
  it("edits dialogue through the UI, saves the registered editor, and reloads its origin", async () => {
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    const edit = screen.getByRole("button", { name: "Edit" });
    expect((edit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(edit);
    const editor = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    await screen.findByText("Edited dialogue");

    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    const submitted = native.saveEvent.mock.calls[0][2] as RpgEvent;
    expect(submitted.pages[0].list[0].parameters[0]).toBe("Edited dialogue");
    expect(submitted.pages[0].list[0].source_index).toBe(0);
    expect(native.loadEvent).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "×" }));
    fireEvent.click(await screen.findByRole("button", { name: "Open event" }));
    await screen.findByText("Edited dialogue");

    expect(native.loadEvent).toHaveBeenCalledTimes(2);
    expect(diskEvent.pages[0].list[0].parameters[0]).toBe("Edited dialogue");
    expect(diskEvent.pages[0].list[0].source_index).toBe(0);
  });

  it("shows and edits every line in a multi-step Show Text command", async () => {
    diskEvent.pages[0].list = [
      { code: 101, indent: 0, parameters: ["A long opening dialogue line for a narrow phone screen"], source_index: 0 },
      { code: 401, indent: 0, parameters: ["A second dialogue line that must remain visible"], source_index: 1 },
      { code: 401, indent: 0, parameters: ["The final dialogue line is preserved too"], source_index: 2 },
      { code: 0, indent: 0, parameters: [], source_index: 3 },
    ];
    renderProject();

    fireEvent.click(await screen.findByText("A long opening dialogue line for a narrow phone screen"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const textarea = await screen.findByRole("textbox", { name: "Show Text dialogue lines" });
    expect((textarea as HTMLTextAreaElement).value).toBe([
      "A long opening dialogue line for a narrow phone screen",
      "A second dialogue line that must remain visible",
      "The final dialogue line is preserved too",
    ].join("\n"));

    fireEvent.change(textarea, {
      target: { value: "Edited opening line\nEdited middle line\nEdited final line" },
    });
    fireEvent.blur(textarea);
    await screen.findByText("Edited middle line");
    await screen.findByText("Edited final line");
    fireEvent.click(screen.getByRole("button", { name: "Save All" }));
    await screen.findByRole("status");

    expect(diskEvent.pages[0].list.map((command) => command.code)).toEqual([101, 401, 401, 0]);
    expect(diskEvent.pages[0].list.slice(0, 3).map((command) => command.parameters[0])).toEqual([
      "Edited opening line",
      "Edited middle line",
      "Edited final line",
    ]);
  });

  it("saves the edited event and closes it from the explicit OK action", async () => {
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    await screen.findByText("Edited dialogue");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByRole("button", { name: "Open event" });

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    expect(diskEvent.pages[0].list[0].parameters[0]).toBe("Edited dialogue");
    expect(screen.queryByRole("button", { name: "OK" })).toBeNull();
  });

  it("keeps the editor open when the OK action cannot persist the event", async () => {
    native.saveEvent.mockRejectedValueOnce(new Error("synthetic write failure"));
    renderProject();

    fireEvent.click(await screen.findByText("Original dialogue"));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const editor = await screen.findByDisplayValue("Original dialogue");
    fireEvent.change(editor, { target: { value: "Edited dialogue" } });
    fireEvent.blur(editor);
    await screen.findByText("Edited dialogue");

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    await screen.findByText(/Save failed: Error: synthetic write failure/);

    expect(native.saveEvent).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "OK" })).toBeTruthy();
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
