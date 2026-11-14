// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapTreePanel } from "../src/components/MapTree/MapTreePanel";
import type { MapInfo } from "../src/types";

const mapInfos: Record<number, MapInfo> = {
  1: { name: "Kanto", parent_id: 0, order: 0, expanded: false, scroll_x: 0, scroll_y: 0 },
  2: { name: "Route 1", parent_id: 1, order: 0, expanded: false, scroll_x: 0, scroll_y: 0 },
  3: { name: "Pokémon Center", parent_id: 2, order: 0, expanded: false, scroll_x: 0, scroll_y: 0 },
  4: { name: "Harbor", parent_id: 0, order: 1, expanded: false, scroll_x: 0, scroll_y: 0 },
};

function renderMapTree(currentMapId: number | null = null, onSelectMap = vi.fn()) {
  return render(
    <MapTreePanel
      mapInfos={mapInfos}
      currentMapId={currentMapId}
      onSelectMap={onSelectMap}
      onCreateMap={vi.fn()}
      onDeleteMap={vi.fn()}
      onRenameMap={vi.fn()}
      onMapProperties={vi.fn()}
    />,
  );
}

describe("project map tree browsing", () => {
  afterEach(cleanup);

  it("reveals the selected map within its collapsed hierarchy", async () => {
    renderMapTree(3);

    expect(await screen.findByRole("treeitem", { name: /003.*Pokémon Center/ })).toBeTruthy();
  });

  it("searches maps by name or padded ID and opens only matching paths", () => {
    renderMapTree();

    fireEvent.change(screen.getByRole("searchbox", { name: "Search maps by name or ID" }), {
      target: { value: "Pokémon Center" },
    });
    expect(screen.getByRole("treeitem", { name: /001.*Kanto/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /002.*Route 1/ })).toBeTruthy();
    expect(screen.getByRole("treeitem", { name: /003.*Pokémon Center/ })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: /004.*Harbor/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Clear map search" }));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search maps by name or ID" }), {
      target: { value: "004" },
    });
    expect(screen.getByRole("treeitem", { name: /004.*Harbor/ })).toBeTruthy();
    expect(screen.queryByRole("treeitem", { name: /001.*Kanto/ })).toBeNull();
  });

  it("reports an empty search and keeps the tree usable after clearing it", () => {
    renderMapTree();
    const search = screen.getByRole("searchbox", { name: "Search maps by name or ID" });

    fireEvent.change(search, { target: { value: "missing map" } });
    expect(screen.getByRole("status").textContent).toContain("No maps match");

    fireEvent.click(screen.getByRole("button", { name: "Clear map search" }));
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("treeitem", { name: /001.*Kanto/ })).toBeTruthy();
  });

  it("opens native map actions from a touch-sized per-map button without selecting the map", () => {
    const onSelectMap = vi.fn();
    const onCreateMap = vi.fn();
    const onRenameMap = vi.fn();
    render(
      <MapTreePanel mapInfos={mapInfos} currentMapId={null}
        onSelectMap={onSelectMap} onCreateMap={onCreateMap}
        onDeleteMap={vi.fn()} onRenameMap={onRenameMap}
        onMapProperties={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Map actions for Harbor" }), {
      clientX: window.innerWidth - 2,
      clientY: window.innerHeight - 2,
    });
    const menu = document.querySelector(".map-tree-context-menu") as HTMLElement;
    expect(menu).toBeTruthy();
    expect(Number.parseFloat(menu.style.left)).toBeLessThanOrEqual(window.innerWidth - 200);
    expect(Number.parseFloat(menu.style.top)).toBeLessThanOrEqual(window.innerHeight - 320);
    expect(onSelectMap).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "New Child Map..." }));
    expect(onCreateMap).toHaveBeenCalledWith(4);
    expect(onSelectMap).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Rename..." })).toBeNull();
  });

  it("keeps map organisation actions unavailable in read-only preview", () => {
    const onCreateMap = vi.fn();
    const onSelectMap = vi.fn();
    render(
      <MapTreePanel mapInfos={mapInfos} currentMapId={null}
        onSelectMap={onSelectMap} onCreateMap={onCreateMap}
        onDeleteMap={vi.fn()} onRenameMap={vi.fn()}
        onMapProperties={vi.fn()} readOnly
      />,
    );
    expect(screen.queryByRole("button", { name: "Map actions for Harbor" })).toBeNull();
    expect(screen.queryByTitle("Create new map")).toBeNull();
    fireEvent.click(screen.getByRole("treeitem", { name: /004.*Harbor/ }));
    expect(onSelectMap).toHaveBeenCalledWith(4);
    expect(onCreateMap).not.toHaveBeenCalled();
  });

  it("opens the selected real map ID from filtered results", () => {
    const onSelectMap = vi.fn();
    renderMapTree(null, onSelectMap);

    fireEvent.change(screen.getByRole("searchbox", { name: "Search maps by name or ID" }), {
      target: { value: "Pokémon Center" },
    });
    fireEvent.click(screen.getByRole("treeitem", { name: /003.*Pokémon Center/ }));

    expect(onSelectMap).toHaveBeenCalledWith(3);
  });
});
