// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({ invoke: vi.fn(), save: vi.fn() }));
vi.mock("../src/services/tauriApi", () => ({ invoke: native.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: native.save }));
import { exportSpritePng, spritePngFilename } from "../src/services/spriteExport";

const png = "data:image/png;base64,cGl4ZWxz";
const id = "export-sprite-test";
const uri = "content://provider/document/42";
beforeEach(() => {
  vi.stubGlobal("navigator", { userAgent: "Android" });
  native.invoke.mockImplementation(async (command: string) => {
    if (command === "begin_sprite_png_export") return { export_id: id, size: 12 };
    if (command === "save_sprite_png_to_document") return 12;
  });
  native.save.mockResolvedValue(uri);
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });
describe("standalone sprite PNG export", () => {
  it("stages, chooses a PNG document, verifies and removes staging", async () => {
    expect(await exportSpritePng(png, "Guide.png")).toBe("saved");
    expect(native.invoke).toHaveBeenNthCalledWith(1, "begin_sprite_png_export", { imageData: png });
    expect(native.save).toHaveBeenCalledWith({ defaultPath: "Guide.png", filters: [{ name: "PNG images", extensions: ["png"] }] });
    expect(native.invoke).toHaveBeenNthCalledWith(2, "save_sprite_png_to_document", { exportId: id, documentUri: uri });
    expect(native.invoke).toHaveBeenNthCalledWith(3, "discard_sprite_png_export", { exportId: id });
  });
  it("cancellation never writes a destination and still removes staging", async () => {
    native.save.mockResolvedValue(null);
    expect(await exportSpritePng(png, "Guide")).toBe("cancelled");
    expect(native.invoke).toHaveBeenCalledTimes(2);
    expect(native.invoke).toHaveBeenLastCalledWith("discard_sprite_png_export", { exportId: id });
  });
  it("rejects a mismatched native byte count and removes staging", async () => {
    native.invoke.mockImplementation(async (command: string) => {
      if (command === "begin_sprite_png_export") return { export_id: id, size: 12 };
      if (command === "save_sprite_png_to_document") return 11;
    });
    await expect(exportSpritePng(png, "Guide")).rejects.toThrow("PNG export readback size mismatch");
    expect(native.invoke).toHaveBeenLastCalledWith("discard_sprite_png_export", { exportId: id });
  });
  it("normalizes filenames without path traversal", () => {
    expect(spritePngFilename("../Guide.png")).toBe("___Guide.png");
    expect(spritePngFilename("")).toBe("Sprite.png");
  });
});
