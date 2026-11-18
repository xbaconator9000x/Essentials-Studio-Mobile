// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileOperationFeedback } from "../src/components/MobileOperationFeedback";

afterEach(cleanup);

function renderMessage(props: {
  progress?: string | null;
  outcome?: string | null;
  error?: string | null;
} = {}) {
  const onDismissOutcome = vi.fn();
  const onDismissError = vi.fn();
  const view = render(
    <MobileOperationFeedback
      onDismissOutcome={onDismissOutcome}
      onDismissError={onDismissError}
      {...props}
    />,
  );
  return { view, onDismissOutcome, onDismissError };
}

describe("mobile native project operation feedback", () => {
  it("does not occupy canvas space with no active operation or receipt", () => {
    const { view } = renderMessage();
    expect(view.container.firstChild).toBeNull();
  });

  it("preserves the full ZIP destination and checksum message behind Details", () => {
    const receipt = "ZIP saved to the selected Android document and byte-verified. " +
      "Long destination: /storage/emulated/0/Documents/Shattered-export-2026.zip";
    const { view, onDismissOutcome } = renderMessage({ outcome: receipt });
    expect(screen.getByRole("status").textContent).toContain(receipt);
    const banner = view.container.querySelector(".app-mobile-operation-feedback")!;
    expect(banner.classList.contains("is-expanded")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show full operation details" }));
    expect(banner.classList.contains("is-expanded")).toBe(true);
    expect(screen.getByRole("status").textContent).toContain(receipt);
    fireEvent.click(screen.getByRole("button", { name: "Collapse operation details" }));
    expect(banner.classList.contains("is-expanded")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Dismiss operation message" }));
    expect(onDismissOutcome).toHaveBeenCalledOnce();
  });

  it("gives native failures an alert with accessible details and dismissal", () => {
    const { onDismissError } = renderMessage({
      error: "Project ZIP export failed: Android document provider denied permission",
    });
    expect(screen.getByRole("alert").textContent).toContain("denied permission");
    fireEvent.click(screen.getByRole("button", { name: "Show full operation details" }));
    expect(screen.getByRole("alert").textContent).toContain("Project ZIP export failed");
    fireEvent.click(screen.getByRole("button", { name: "Dismiss operation error" }));
    expect(onDismissError).toHaveBeenCalledOnce();
  });

  it("shows active native progress before earlier receipts or errors", () => {
    renderMessage({
      progress: "Writing and byte-verifying the selected Android document...",
      outcome: "Old export completed",
      error: "Earlier error",
    });
    expect(screen.getByRole("status").textContent).toContain("byte-verifying");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("resets expanded state when another operation receipt arrives", () => {
    const { view } = renderMessage({ outcome: "Old long export receipt" });
    fireEvent.click(screen.getByRole("button", { name: "Show full operation details" }));
    expect(view.container.firstElementChild?.classList.contains("is-expanded")).toBe(true);
    view.rerender(
      <MobileOperationFeedback
        outcome="Fresh Save All receipt"
        onDismissOutcome={vi.fn()}
        onDismissError={vi.fn()}
      />,
    );
    expect(screen.getByRole("status").textContent).toContain("Fresh Save All receipt");
    expect(view.container.firstElementChild?.classList.contains("is-expanded")).toBe(false);
  });
});
