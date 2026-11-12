// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileWorkspaceBar } from "../src/components/MobileWorkspaceBar";

afterEach(cleanup);

function renderActions(overrides: Partial<Parameters<typeof MobileWorkspaceBar>[0]> = {}) {
  const actions = {
    onShowProjects: vi.fn(),
    onToggleEditing: vi.fn(),
    onTogglePalette: vi.fn(),
    onSaveAll: vi.fn(),
    onExportZip: vi.fn(),
  };
  const view = render(
    <MobileWorkspaceBar
      section="maps"
      projectName="Shattered"
      mapName="Viridian City"
      dirtyCount={2}
      busy={false}
      editingEnabled={false}
      paletteVisible={false}
      {...actions}
      {...overrides}
    />,
  );
  return { view, actions };
}

describe("mobile portrait workspace commands", () => {
  it("keeps Save All and ZIP export reachable alongside map editing controls", () => {
    const { actions } = renderActions();
    expect(screen.getByText("Viridian City")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("2 unsaved");
    fireEvent.click(screen.getByRole("button", { name: "Enable map editing" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tile palette" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose another map" }));
    fireEvent.click(screen.getByRole("button", { name: "Save all changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Export project ZIP" }));
    expect(actions.onToggleEditing).toHaveBeenCalledTimes(1);
    expect(actions.onTogglePalette).toHaveBeenCalledTimes(1);
    expect(actions.onShowProjects).toHaveBeenCalledTimes(1);
    expect(actions.onSaveAll).toHaveBeenCalledTimes(1);
    expect(actions.onExportZip).toHaveBeenCalledTimes(1);
  });

  it("shows actual editing/palette state without mutating it when navigating", () => {
    const { actions } = renderActions({ editingEnabled: true, paletteVisible: true });
    expect(screen.getByRole("button", { name: "Switch map to view mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Hide tile palette" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Choose another map" }));
    expect(actions.onToggleEditing).not.toHaveBeenCalled();
    expect(actions.onTogglePalette).not.toHaveBeenCalled();
  });

  it("guards all project writes and editor mode changes while a native save is active", () => {
    const { actions } = renderActions({ busy: true });
    for (const name of [
      "Choose another map", "Enable map editing", "Open tile palette",
      "Save all changes", "Export project ZIP",
    ]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    for (const callback of Object.values(actions)) expect(callback).not.toHaveBeenCalled();
  });

  it("exposes opt-in map hierarchy management without entering the map canvas", () => {
    const { actions } = renderActions({ section: "projects", editingEnabled: false });
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
    const edit = screen.getByRole("button", { name: "Enable map organisation" });
    expect(edit.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(edit);
    expect(actions.onToggleEditing).toHaveBeenCalledTimes(1);
    expect(actions.onShowProjects).not.toHaveBeenCalled();
  });

  it("has Save All and export on Projects and Settings without unrelated map buttons", () => {
    const { view, actions } = renderActions({
      section: "projects", mapName: null, dirtyCount: 0,
    });
    expect(screen.getByText("Shattered")).toBeTruthy();
    expect(screen.getByText("Saved")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enable map editing" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open tile palette" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save all changes" }));
    expect(actions.onSaveAll).toHaveBeenCalledTimes(1);
    view.rerender(
      <MobileWorkspaceBar section="settings" projectName="Shattered"
        mapName={null} dirtyCount={0} busy={false} editingEnabled={false} paletteVisible={false}
        {...actions}
      />,
    );
    expect(screen.getByRole("button", { name: "Export project ZIP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
  });
});
