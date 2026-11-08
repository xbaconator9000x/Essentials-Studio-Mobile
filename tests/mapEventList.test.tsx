// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
