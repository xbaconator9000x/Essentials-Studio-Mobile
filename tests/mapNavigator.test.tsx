// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MapNavigator } from "../src/components/MapEditor/MapNavigator";
import type { ComponentProps } from "react";
import type { EventInfo } from "../src/types";

const events = [{
  id: 9, name: "Sailor", x: 7, y: 2, page_count: 2,
  graphic_name: "", graphic_direction: 2, graphic_pattern: 0,
}] as EventInfo[];

function setup(overrides: Partial<ComponentProps<typeof MapNavigator>> = {}) {
  const onNavigate = vi.fn();
  const onPlaceEvent = vi.fn();
  const onOpenEvent = vi.fn();
  const onClose = vi.fn();
  render(<MapNavigator
    mapWidth={200} mapHeight={120} events={events}
    initialTile={{ x: 4, y: 5 }} startTile={{ x: 2, y: 3 }}
    canCreateEvent canPasteEvent eventPlacementPending={false}
    onNavigate={onNavigate} onPlaceEvent={onPlaceEvent}
    onOpenEvent={onOpenEvent} onClose={onClose}
    {...overrides}
  />);
  return { onNavigate, onPlaceEvent, onOpenEvent, onClose };
}

describe("touch coordinate navigator", () => {
  afterEach(() => cleanup());

  it("navigates to precise XP coordinates without touching event or tile data", () => {
    const { onNavigate, onPlaceEvent } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Map tile X coordinate" }), { target: { value: "159" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Map tile Y coordinate" }), { target: { value: "119" } });
    fireEvent.click(screen.getByRole("button", { name: "Go to map coordinates" }));
    expect(onNavigate).toHaveBeenCalledWith({ x: 159, y: 119 });
    expect(onPlaceEvent).not.toHaveBeenCalled();
  });

  it("rejects malformed coordinates and prevents event mutation", () => {
    const { onNavigate, onPlaceEvent } = setup();
    const input = screen.getByRole("textbox", { name: "Map tile X coordinate" });
    for (const value of ["-1", "1.5", "1e2", "200", "", "oops"]) {
      fireEvent.change(input, { target: { value } });
      expect((screen.getByRole("button", { name: "Go to map coordinates" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Create event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
      expect((screen.getByRole("button", { name: "Paste event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(onNavigate).not.toHaveBeenCalled();
    expect(onPlaceEvent).not.toHaveBeenCalled();
  });

  it("routes creation and paste through the existing project callbacks", () => {
    const { onPlaceEvent } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Create event at coordinates" }));
    expect(onPlaceEvent).toHaveBeenLastCalledWith("create", { x: 4, y: 5 });
    fireEvent.click(screen.getByRole("button", { name: "Paste event at coordinates" }));
    expect(onPlaceEvent).toHaveBeenLastCalledWith("paste", { x: 4, y: 5 });
  });

  it("prevents placing another event over an existing RMXP event and opens it instead", () => {
    const { onPlaceEvent, onOpenEvent } = setup();
    fireEvent.change(screen.getByRole("textbox", { name: "Map tile X coordinate" }), { target: { value: "7" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Map tile Y coordinate" }), { target: { value: "2" } });
    expect((screen.getByRole("button", { name: "Create event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Edit event" }));
    expect(onOpenEvent).toHaveBeenCalledWith(9, "Sailor");
    expect(onPlaceEvent).not.toHaveBeenCalled();
  });

  it("jumps to the player start or a selected event and fills coordinate inputs", () => {
    const { onNavigate } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Go to player start" }));
    expect(onNavigate).toHaveBeenCalledWith({ x: 2, y: 3 });
    fireEvent.change(screen.getByRole("combobox", { name: "Jump to existing map event" }),
      { target: { value: "9" } });
    expect(onNavigate).toHaveBeenLastCalledWith({ x: 7, y: 2 });
    expect((screen.getByRole("textbox", { name: "Map tile X coordinate" }) as HTMLInputElement).value).toBe("7");
  });

  it("allows read-only navigation but never event mutations", () => {
    const { onNavigate, onPlaceEvent } = setup({ readOnly: true });
    expect(screen.queryByRole("button", { name: "Create event at coordinates" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste event at coordinates" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Go to map coordinates" }));
    expect(onNavigate).toHaveBeenCalledWith({ x: 4, y: 5 });
    expect(onPlaceEvent).not.toHaveBeenCalled();
  });

  it("disables placement while native event paste is saving", () => {
    setup({ eventPlacementPending: true });
    expect((screen.getByRole("button", { name: "Create event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Paste event at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("updates the player start using the native async callback and prevents duplicate taps", async () => {
    let resolveSave: (() => void) | undefined;
    const onSetStartPosition = vi.fn(() => new Promise<void>(resolve => { resolveSave = resolve; }));
    setup({ onSetStartPosition });
    fireEvent.click(screen.getByRole("button", { name: "Set player start at coordinates" }));
    expect(onSetStartPosition).toHaveBeenCalledWith(4, 5);
    expect((screen.getByRole("button", { name: "Set player start at coordinates" }) as HTMLButtonElement).disabled).toBe(true);
    resolveSave?.();
    await waitFor(() => expect((screen.getByRole("button", { name: "Set player start at coordinates" }) as HTMLButtonElement).disabled).toBe(false));
  });

  it("reports native start-position failure without changing the coordinates", async () => {
    setup({ onSetStartPosition: vi.fn(async () => { throw new Error("disk full"); }) });
    fireEvent.click(screen.getByRole("button", { name: "Set player start at coordinates" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not save the player starting position.");
    expect((screen.getByRole("textbox", { name: "Map tile X coordinate" }) as HTMLInputElement).value).toBe("4");
  });

});
