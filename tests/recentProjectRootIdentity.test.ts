import { describe, expect, it } from "vitest";
import { getLastMapId, getRecentProjectPaths, projectPathIdentity, rememberLastMapId, rememberRecentProjectPath } from "../src/services/recentProject";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

describe("native project path identity", () => {
  it("preserves Windows drive roots separately from drive-relative paths", () => {
    expect(projectPathIdentity("C:\\")).toBe("C:/");
    expect(projectPathIdentity("C:/")).toBe("C:/");
    expect(projectPathIdentity("C:")).toBe("C:");
    expect(projectPathIdentity("C:/")).not.toBe(projectPathIdentity("C:"));
  });

  it("preserves POSIX and UNC roots while normalizing ordinary trailing separators", () => {
    expect(projectPathIdentity("/")).toBe("/");
    expect(projectPathIdentity("//")).toBe("//");
    expect(projectPathIdentity("\\\\server\\share\\")).toBe("//server/share");
    expect(projectPathIdentity("/projects/Shattered///")).toBe("/projects/Shattered");
    expect(projectPathIdentity("D:\\Games\\Shattered\\")).toBe("D:/Games/Shattered");
  });

  it("deduplicates separator aliases without losing native paths or mixing root selections", () => {
    const storage = memoryStorage();
    rememberRecentProjectPath("C:", storage);
    rememberRecentProjectPath("C:\\", storage);
    rememberRecentProjectPath("D:\\Games\\Shattered\\", storage);
    rememberRecentProjectPath("D:/Games/Shattered", storage);
    expect(getRecentProjectPaths(storage)).toEqual(["D:/Games/Shattered", "C:\\", "C:"]);
    rememberLastMapId("C:", 3, storage);
    rememberLastMapId("C:\\", 7, storage);
    expect(getLastMapId("C:", storage)).toBe(3);
    expect(getLastMapId("C:/", storage)).toBe(7);
  });
});
