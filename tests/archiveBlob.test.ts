import { afterEach, describe, expect, it, vi } from "vitest";
import { readBlobArrayBuffer } from "../src/services/archiveBlob";

describe("archive Blob reads", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses FileReader when Blob.arrayBuffer is unavailable", async () => {
    const bytes = new Uint8Array([0, 1, 127, 255]);
    const blob = new Blob([bytes]);
    const nativeArrayBuffer = Blob.prototype.arrayBuffer;
    Object.defineProperty(blob, "arrayBuffer", { value: undefined });

    class TestFileReader {
      result: ArrayBuffer | null = null;
      error: DOMException | null = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      readAsArrayBuffer(source: Blob) {
        nativeArrayBuffer.call(source).then(
          (result) => {
            this.result = result;
            this.onload?.();
          },
          () => this.onerror?.(),
        );
      }
    }

    vi.stubGlobal("FileReader", TestFileReader);

    await expect(readBlobArrayBuffer(blob)).resolves.toEqual(bytes.buffer);
  });

  it("rejects if the platform cannot read Blobs", async () => {
    const blob = new Blob(["data"]);
    Object.defineProperty(blob, "arrayBuffer", { value: undefined });
    vi.stubGlobal("FileReader", undefined);

    await expect(readBlobArrayBuffer(blob)).rejects.toThrow(
      "This browser cannot read project ZIP data",
    );
  });
});
