// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { installEditorBackHandler } from "../src/services/editorBackNavigation";

describe("editor browser-back handling", () => {
  let removeHandler: (() => void) | undefined;

  afterEach(() => {
    removeHandler?.();
    removeHandler = undefined;
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
});
