// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installEditorBackHandler } from "../src/services/editorBackNavigation";

describe("editor browser-back handling", () => {
  let removeHandler: (() => void) | undefined;
  let restoreViewport: (() => void) | undefined;

  afterEach(() => {
    removeHandler?.();
    removeHandler = undefined;
    restoreViewport?.();
    restoreViewport = undefined;
    vi.useRealTimers();
  });

  it("translates browser Back into Escape and re-arms while the editor is open", () => {
    const onKeyDown = vi.fn();
    window.addEventListener("keydown", onKeyDown);
    removeHandler = installEditorBackHandler(window);

    window.dispatchEvent(new PopStateEvent("popstate"));
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(onKeyDown).toHaveBeenCalledTimes(2);
    expect(onKeyDown.mock.calls.map(([event]) => event.key)).toEqual(["Escape", "Escape"]);
    expect(window.history.state).toEqual({ essentialsStudioEditorBack: true });

    window.removeEventListener("keydown", onKeyDown);
  });

  it("uses the first Back to dismiss the keyboard, then routes a later Back to Escape", () => {
    vi.useFakeTimers();
    const originalViewport = Object.getOwnPropertyDescriptor(window, "visualViewport");
    let height = 400;
    const viewport = new EventTarget() as VisualViewport;
    Object.defineProperty(viewport, "height", { get: () => height });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
    restoreViewport = () => {
      if (originalViewport) {
        Object.defineProperty(window, "visualViewport", originalViewport);
      } else {
        Reflect.deleteProperty(window, "visualViewport");
      }
    };

    const onKeyDown = vi.fn();
    window.addEventListener("keydown", onKeyDown);
    removeHandler = installEditorBackHandler(window, viewport);

    height = 200;
    viewport.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onKeyDown).not.toHaveBeenCalled();

    height = 400;
    viewport.dispatchEvent(new Event("resize"));
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onKeyDown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1001);
    window.dispatchEvent(new PopStateEvent("popstate"));
    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown.mock.calls[0][0].key).toBe("Escape");

    window.removeEventListener("keydown", onKeyDown);
  });
});
