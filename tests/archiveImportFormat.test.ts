import { describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("../src/services/tauriApi", () => native);

import { importProjectZip } from "../src/services/archiveApi";

describe("project archive import format errors", () => {
  it("explains unsupported RAR files before starting native import", async () => {
    const file = new File(["private archive"], "Essentials.RAR");

    await expect(importProjectZip(file)).rejects.toThrow(
      "Extract the archive locally, then create a ZIP containing the project folder with Game.rxproj",
    );
    expect(native.invoke).not.toHaveBeenCalled();
  });

  it("rejects a RAR payload mislabeled as ZIP before starting native import", async () => {
    const signature = new Uint8Array([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07, 0x01, 0x00]);
    const file = new File([signature], "project.zip");

    await expect(importProjectZip(file)).rejects.toThrow("RAR archives are not supported");
    expect(native.invoke).not.toHaveBeenCalled();
  });
});
