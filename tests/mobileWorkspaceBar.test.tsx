// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MobileWorkspaceBar } from "../src/components/MobileWorkspaceBar";
import { MobileBottomNavigation } from "../src/components/MobileBottomNavigation";

afterEach(cleanup);

function renderActions(overrides: Partial<Parameters<typeof MobileWorkspaceBar>[0]> = {}) {
  const actions = {
    onShowProjects: vi.fn(), onToggleEditing: vi.fn(), onTogglePalette: vi.fn(),
    onSaveAll: vi.fn(), onExportZip: vi.fn(),
  };
  const view = render(<MobileWorkspaceBar section="maps" projectName="Shattered"
    mapName="Viridian City" dirtyCount={2} busy={false}
    editingEnabled={false} paletteVisible={false} {...actions} {...overrides} />);
  return { view, actions };
}

describe("canvas-first mobile workspace commands", () => {
  it("keeps Save and ZIP reachable with a collapsed, accessible contextual tool group", () => {
    const { actions } = renderActions();
    expect(screen.getByText("Viridian City")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("2 unsaved");
    expect(screen.queryByRole("button", { name: "Enable map editing" })).toBeNull();
    const expand = screen.getByRole("button", { name: "Show map tools" });
    expect(expand.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(screen.getByRole("button", { name: "Save all changes" }));
    fireEvent.click(screen.getByRole("button", { name: "Export project ZIP" }));
    expect(actions.onSaveAll).toHaveBeenCalledTimes(1);
    expect(actions.onExportZip).toHaveBeenCalledTimes(1);
    fireEvent.click(expand);
    expect(screen.getByRole("button", { name: "Hide map tools" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Enable map editing" }));
    expect(screen.queryByRole("button", { name: "Open tile palette" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show map tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Open tile palette" }));
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show map tools" }));
    fireEvent.click(screen.getByRole("button", { name: "Choose another map" }));
    expect(actions.onToggleEditing).toHaveBeenCalledTimes(1);
    expect(actions.onTogglePalette).toHaveBeenCalledTimes(1);
    expect(actions.onShowProjects).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Show map tools" }).getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("button", { name: "Open tile palette" })).toBeNull();
    expect(screen.getByRole("button", { name: "Save all changes" })).toBeTruthy();
  });

  it("announces dirty and busy state without losing context or Save/Export", () => {
    const { view, actions } = renderActions({ dirtyCount: 3 });
    const workspace = screen.getByLabelText("Mobile workspace actions");
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("3 unsaved");
    view.rerender(<MobileWorkspaceBar section="maps" projectName="Shattered"
      mapName="Viridian City" dirtyCount={0} busy={true}
      editingEnabled={true} paletteVisible={true} {...actions} />);
    expect(screen.getByRole("status")).toBe(status);
    expect(status.textContent).toBe("Saved");
    expect(workspace.getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "Save all changes" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Show map tools" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("Viridian City")).toBeTruthy();
  });

  it("preserves existing edit and tileset state when opening tools or returning to the map chooser", () => {
    const { actions } = renderActions({ editingEnabled: true, paletteVisible: true });
    fireEvent.click(screen.getByRole("button", { name: "Show map tools" }));
    expect(screen.getByRole("button", { name: "Switch map to view mode" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Hide tile palette" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Choose another map" }));
    expect(actions.onShowProjects).toHaveBeenCalledTimes(1);
    expect(actions.onToggleEditing).not.toHaveBeenCalled();
    expect(actions.onTogglePalette).not.toHaveBeenCalled();
  });

  it("prevents repeated writes and map mutations during native operations even with tools expanded", () => {
    const { actions, view } = renderActions();
    fireEvent.click(screen.getByRole("button", { name: "Show map tools" }));
    view.rerender(<MobileWorkspaceBar section="maps" projectName="Shattered" mapName="Viridian City"
      dirtyCount={2} busy={true} editingEnabled={false} paletteVisible={false} {...actions} />);
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
    expect(screen.getByRole("button", { name: "Show map tools" }).getAttribute("aria-expanded")).toBe("false");
    for (const name of ["Save all changes", "Export project ZIP", "Show map tools"]) {
      const button = screen.getByRole("button", { name }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("offers map organisation only on Projects and keeps ZIP commands on every section", () => {
    const { view, actions } = renderActions({ section: "projects", editingEnabled: false });
    expect(screen.queryByRole("button", { name: "Show map tools" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show project tools" }));
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open tile palette" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enable map organisation" }));
    expect(actions.onToggleEditing).toHaveBeenCalledTimes(1);
    view.rerender(<MobileWorkspaceBar section="settings" projectName="Shattered" mapName={null}
      dirtyCount={0} busy={false} editingEnabled={false} paletteVisible={false} {...actions} />);
    expect(screen.getByRole("button", { name: "Export project ZIP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Show project tools" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Choose another map" })).toBeNull();
    view.rerender(<MobileWorkspaceBar section="sprites" projectName="Shattered" mapName={null}
      dirtyCount={1} busy={false} editingEnabled={false} paletteVisible={false} {...actions} />);
    expect(screen.getByRole("status").textContent).toBe("1 unsaved");
    expect(screen.getByRole("button", { name: "Save all changes" })).toBeTruthy();
  });
});

describe("mobile bottom navigation", () => {
  it("switches functional destinations while announcing the active section", () => {
    const onNavigate = vi.fn();
    const view = render(<MobileBottomNavigation section="projects" hasMap={true} busy={false}
      onNavigate={onNavigate} />);
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Projects" }).getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Maps" }));
    fireEvent.click(screen.getByRole("button", { name: "Sprites" }));
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(onNavigate.mock.calls.map(([section]) => section)).toEqual(["maps", "sprites", "settings"]);
    view.rerender(<MobileBottomNavigation section="maps" hasMap={true} busy={false} onNavigate={onNavigate} />);
    expect(screen.getByRole("button", { name: "Maps" }).getAttribute("aria-current")).toBe("page");
  });

  it("guides users to Projects if a map is not loaded, and blocks tabs during Save All", () => {
    const onNavigate = vi.fn();
    const view = render(<MobileBottomNavigation section="projects" hasMap={false} busy={false}
      onNavigate={onNavigate} />);
    const maps = screen.getByRole("button", { name: "Maps" }) as HTMLButtonElement;
    expect(maps.disabled).toBe(true);
    expect(maps.title).toContain("Choose a map");
    fireEvent.click(maps);
    expect(onNavigate).not.toHaveBeenCalled();
    view.rerender(<MobileBottomNavigation section="projects" hasMap={true} busy={true}
      onNavigate={onNavigate} />);
    expect(screen.getByRole("navigation", { name: "Main navigation" }).getAttribute("aria-busy")).toBe("true");
    for (const section of ["Projects", "Maps", "Sprites", "Settings"]) {
      const button = screen.getByRole("button", { name: section }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    }
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
