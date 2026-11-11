// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MapEventList } from "../src/components/MapEditor/MapEventList";
import type { EventInfo } from "../src/types";

const events: EventInfo[] = [
  { id: 2, name: "Guide", x: 8, y: 4, page_count: 2, graphic_name: "Guide", graphic_direction: 2, graphic_pattern: 0 },
  { id: 9, name: "Hidden switch", x: 11, y: 5, page_count: 1, graphic_name: "", graphic_direction: 2, graphic_pattern: 0 },
];

describe("map event browser", () => {
  afterEach(cleanup);

  it("closes the browser and opens the selected event through the shared EventEditor callback", () => {
    const onOpenEvent = vi.fn();
    const onClose = vi.fn(() => order.push("close"));
    const order: string[] = [];
    onOpenEvent.mockImplementation(() => order.push("open"));
    render(<MapEventList events={events} onOpenEvent={onOpenEvent} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: /002.*Guide.*8, 4/ }));

    expect(onOpenEvent).toHaveBeenCalledWith(2, "Guide");
    expect(order).toEqual(["close", "open"]);
    expect(screen.getByText("2 pages")).toBeTruthy();
  });

  it("locates an event on the map without opening the event editor", () => {
    const onFocusEvent = vi.fn();
    const onOpenEvent = vi.fn();
    const onClose = vi.fn(() => order.push("close"));
    const order: string[] = [];
    onFocusEvent.mockImplementation(() => order.push("focus"));
    render(
      <MapEventList
        events={events}
        onFocusEvent={onFocusEvent}
        onOpenEvent={onOpenEvent}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Locate event 009 Hidden switch on map" }));

    expect(onFocusEvent).toHaveBeenCalledWith(9);
    expect(onOpenEvent).not.toHaveBeenCalled();
    expect(order).toEqual(["close", "focus"]);
  });

  it("copies an event from its visible touch action without closing the browser", async () => {
    const onCopyEvent = vi.fn(async () => {});
    render(
      <MapEventList
        events={events}
        onOpenEvent={vi.fn()}
        onCopyEvent={onCopyEvent}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy event 002 Guide" }));

    await waitFor(() => expect(onCopyEvent).toHaveBeenCalledWith(2));
    expect(screen.getByRole("region", { name: "Map events" })).toBeTruthy();
  });

  it("keeps event information visible but prevents editing in read-only preview", () => {
    render(<MapEventList events={events} onClose={vi.fn()} />);

    const eventButton = screen.getByRole("button", { name: /009.*Hidden switch/ });
    expect(eventButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText("(11, 5)")).toBeTruthy();
  });

  it("filters map events by name, padded ID, and tile coordinates", () => {
    render(<MapEventList events={events} onOpenEvent={vi.fn()} onClose={vi.fn()} />);
    const search = screen.getByRole("searchbox", { name: "Search map events by name, ID, or location" });

    fireEvent.change(search, { target: { value: "009" } });
    expect(screen.getByRole("button", { name: /009.*Hidden switch/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /002.*Guide/ })).toBeNull();

    fireEvent.change(search, { target: { value: "8,4" } });
    expect(screen.getByRole("button", { name: /002.*Guide/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /009.*Hidden switch/ })).toBeNull();

    fireEvent.change(search, { target: { value: "nobody" } });
    expect(screen.getByRole("status").textContent).toContain("No map events match");
    fireEvent.click(screen.getByRole("button", { name: "Clear event search" }));
    expect(screen.getByRole("button", { name: /002.*Guide/ })).toBeTruthy();
  });

  it("sorts events by name or map position without mutating the source event array", () => {
    const unsorted = [
      { ...events[0], id: 30, name: "Zebra", x: 1, y: 8 },
      { ...events[1], id: 4, name: "Alpha", x: 6, y: 2 },
      { ...events[0], id: 12, name: "Beta", x: 2, y: 2 },
    ];
    const originalOrder = unsorted.map(event => event.id);
    render(<MapEventList events={unsorted} onOpenEvent={vi.fn()} onClose={vi.fn()} />);
    const ids = () => [...document.querySelectorAll(".map-event-list-name")].map(node => node.textContent?.match(/\d+/)?.[0]);
    expect(ids()).toEqual(["004", "012", "030"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort map events" }), { target: { value: "name" } });
    expect(ids()).toEqual(["004", "012", "030"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort map events" }), { target: { value: "position" } });
    expect(ids()).toEqual(["012", "004", "030"]);
    expect(unsorted.map(event => event.id)).toEqual(originalOrder);
  });

  it("finds events by character graphic and announces filtered counts", () => {
    render(<MapEventList events={[{ ...events[0], name: "Gatekeeper" }, events[1]]}
      onOpenEvent={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("searchbox", { name: "Search map events by name, ID, or location" }), {
      target: { value: "Guide" },
    });
    expect(screen.getByText("1 of 2 events")).toBeTruthy();
    expect(screen.getByRole("button", { name: /002.*Gatekeeper/ })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /009.*Hidden switch/ })).toBeNull();
  });

  it("reverses ID and position sort without changing native event order", () => {
    const originalOrder = events.map((event) => event.id);
    render(<MapEventList events={events} onOpenEvent={vi.fn()} onClose={vi.fn()} />);
    const ids = () => Array.from(document.querySelectorAll(".map-event-list-name"))
      .map((element) => element.textContent?.match(/\\[(\\d+)\\]/)?.[1]);
    expect(ids()).toEqual(["002", "009"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort descending" }));
    expect(ids()).toEqual(["009", "002"]);
    fireEvent.change(screen.getByRole("combobox", { name: "Sort map events" }), { target: { value: "position" } });
    expect(ids()).toEqual(["009", "002"]);
    fireEvent.click(screen.getByRole("button", { name: "Sort ascending" }));
    expect(ids()).toEqual(["002", "009"]);
    expect(events.map((event) => event.id)).toEqual(originalOrder);
  });

  it("renders a useful empty-map state", () => {
    render(<MapEventList events={[]} onClose={vi.fn()} />);

    expect(screen.getByRole("status").textContent).toBe("No events on this map.");
  });

  it("closes the event browser from its touch control", () => {
    const onClose = vi.fn();
    render(<MapEventList events={events} onClose={onClose} />);

    fireEvent.click(screen.getByRole("button", { name: "Close map events" }));

    expect(onClose).toHaveBeenCalledOnce();
  });
});
