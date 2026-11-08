// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EventCommandPicker } from "../src/components/EventEditor/EventCommandPicker";

afterEach(cleanup);

describe("event command picker", () => {
  it("exposes a named dialog with searchable, keyboard-operable command buttons", () => {
    const onSelect = vi.fn();
    render(<EventCommandPicker onSelect={onSelect} onClose={vi.fn()} />);

    expect(screen.getByRole("dialog", { name: "Insert Command" }).getAttribute("aria-modal")).toBe("true");
    const search = screen.getByRole("textbox", { name: "Search event commands" });
    fireEvent.change(search, { target: { value: "display a text" } });

    const showText = screen.getByRole("button", { name: /Show Text/ });
    expect(showText).toBeTruthy();
    expect(showText.tagName).toBe("BUTTON");
    expect(screen.queryByRole("button", { name: /Transfer Player/ })).toBeNull();
    fireEvent.click(showText);

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toMatchObject({ code: 101, name: "Show Text" });
  });

  it("filters by category, reports empty results, and exposes close controls", () => {
    const onClose = vi.fn();
    render(<EventCommandPicker onSelect={vi.fn()} onClose={onClose} />);

    const messageCategory = screen.getByRole("button", { name: "Message" });
    fireEvent.click(messageCategory);
    expect(messageCategory.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /Show Text/ })).toBeTruthy();

    fireEvent.change(screen.getByRole("textbox", { name: "Search event commands" }), {
      target: { value: "no command has this name" },
    });
    expect(screen.getByRole("status").textContent).toBe("No commands match this search.");

    fireEvent.click(screen.getByRole("button", { name: "Close command picker" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
