// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MobileRecentProjects } from "../src/components/MobileRecentProjects";

describe("mobile recent project switcher", () => {
  afterEach(cleanup);
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

  it("uses longer unique path suffixes when parent and project names collide", () => {
    const onSelect = vi.fn();
    render(
      <MobileRecentProjects
        paths={["/sdcard/one/Game", "/private/one/Game", "/other/two/Game"]}
        currentPath="/sdcard/one/Game"
        disabled={false}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("button", { name: "sdcard/one/Game · Current" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "private/one/Game" }));
    expect(onSelect).toHaveBeenCalledWith("/private/one/Game");
    expect(screen.getByRole("button", { name: "two/Game" })).toBeTruthy();
  });

  it("does not show duplicate entries as separate projects", () => {
    const { container } = render(
      <MobileRecentProjects
        paths={["/private/one/Game", "/private/one/Game"]}
        currentPath="/private/one/Game"
        disabled={false}
        onSelect={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
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

  it("filters long recent-project lists by visible suffix and full path without losing switch targets", () => {
    const onSelect = vi.fn();
    render(<MobileRecentProjects paths={[
      "/projects/one/Game", "/projects/two/Game", "/projects/three/Game",
      "/projects/four/Game", "/external/five/Shattered",
    ]} currentPath="/projects/one/Game" disabled={false} onSelect={onSelect} />);
    const search = screen.getByRole("searchbox", { name: "Find recent project" });
    fireEvent.change(search, { target: { value: "FIVE" } });
    expect(screen.getByRole("button", { name: "Shattered" })).toBeTruthy();
    expect(screen.getByRole("status").textContent).toBe("1 of 5 projects");
    expect(screen.queryByRole("button", { name: "two/Game" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shattered" }));
    expect(onSelect).toHaveBeenCalledWith("/external/five/Shattered");
    fireEvent.change(search, { target: { value: "not-a-project" } });
    expect(screen.getByRole("status").textContent).toBe("No matching projects");
    fireEvent.keyDown(search, { key: "Escape" });
    expect((search as HTMLInputElement).value).toBe("");
    expect(screen.getAllByRole("button").length).toBe(5);
  });


  it("deduplicates equivalent picker paths but retains the original native switch target", () => {
    const onSelect = vi.fn();
    render(<MobileRecentProjects
      paths={["C:\\\\Projects\\\\Shattered\\\\", "C:/Projects/Shattered", "/storage/Projects/Other"]}
      currentPath="/storage/Projects/Other/"
      disabled={false} onSelect={onSelect}
    />);
    expect(screen.getByRole("button", { name: "Shattered" })).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Other · Current" }).hasAttribute("aria-current")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Shattered" }));
    expect(onSelect).toHaveBeenCalledWith("C:\\\\Projects\\\\Shattered\\\\");
  });

  it("keeps case-distinct project paths separate on case-sensitive storage", () => {
    render(<MobileRecentProjects
      paths={["/projects/Game", "/projects/game"]}
      currentPath="/projects/Game/"
      disabled={false} onSelect={vi.fn()}
    />);
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Game · Current" }).hasAttribute("aria-current")).toBe(true);
    expect(screen.getByRole("button", { name: "game" })).toBeTruthy();
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
