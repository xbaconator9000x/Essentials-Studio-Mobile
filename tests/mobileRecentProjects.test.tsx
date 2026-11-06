// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileRecentProjects } from "../src/components/MobileRecentProjects";

describe("mobile recent project switcher", () => {
  it("shows the current project and opens another through the supplied guarded callback", () => {
    const onSelect = vi.fn();
    render(
      <MobileRecentProjects
        paths={["/private/projects/Alpha", "/private/projects/Beta"]}
        currentPath="/private/projects/Beta"
        disabled={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("navigation", { name: "Recent projects" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Beta · Current" }).hasAttribute("aria-current")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Alpha" }));
    expect(onSelect).toHaveBeenCalledWith("/private/projects/Alpha");
  });

  it("disambiguates projects with the same folder name and disables switching while busy", () => {
    const onSelect = vi.fn();
    render(
      <MobileRecentProjects
        paths={["/private/one/Game", "/private/two/Game"]}
        currentPath="/private/one/Game"
        disabled
        onSelect={onSelect}
      />,
    );

    expect((screen.getByRole("button", { name: "one/Game · Current" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "two/Game" }) as HTMLButtonElement).disabled).toBe(true);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("renders without Array.prototype.at for older Android WebViews", () => {
    const atDescriptor = Object.getOwnPropertyDescriptor(Array.prototype, "at");
    let textContent: string | null = null;
    try {
      Object.defineProperty(Array.prototype, "at", { configurable: true, writable: true, value: undefined });
      const { container } = render(
        <MobileRecentProjects
          paths={["C:\\private\\one\\Game\\", "/private/two/Game/"]}
          currentPath=""
          disabled={false}
          onSelect={vi.fn()}
        />,
      );
      textContent = container.textContent;
    } finally {
      if (atDescriptor) {
        Object.defineProperty(Array.prototype, "at", atDescriptor);
      } else {
        Reflect.deleteProperty(Array.prototype, "at");
      }
    }

    expect(textContent).toContain("one/Game");
    expect(textContent).toContain("two/Game");
  });

  it("does not render a switcher until there is another project to switch to", () => {
    const { container } = render(
      <MobileRecentProjects
        paths={["/private/projects/Only"]}
        currentPath="/private/projects/Only"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
