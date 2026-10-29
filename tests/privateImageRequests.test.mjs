import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PRIVATE_IMAGE_BYTES,
  PrivateImageLoadCoordinator,
  privateImageCacheKey,
  privateImageReadRequest,
} from "../src/services/privateImageRequests.ts";
import { DecodedImageCache } from "../src/services/imageCacheBudget.ts";

const syntheticPngDataUrl = "data:image/png;base64,iVBORw0KGgo=";

function fixture() {
  const coordinator = new PrivateImageLoadCoordinator();
  const calls = { read: 0, prepare: 0, decode: 0, release: 0, cached: 0 };
  const read = async (request) => {
    calls.read++;
    assert.deepEqual(request, {
      command: "read_private_project_image",
      args: {
        projectPath: "/private/project",
        assetType: "tileset",
        assetName: "Synthetic",
      },
    });
    return syntheticPngDataUrl;
  };
  const prepare = async (dataUrl) => {
    calls.prepare++;
    assert.equal(dataUrl, syntheticPngDataUrl);
    return { src: "blob:synthetic-image", release: () => { calls.release++; } };
  };
  const decode = async (_src, _key, isCurrent) => {
    calls.decode++;
    if (isCurrent()) calls.cached++;
    return { width: 1, height: 1 };
  };
  return { coordinator, calls, read, prepare, decode };
}

test("private image command validates type, root path and flat asset name", () => {
  assert.deepEqual(
    privateImageReadRequest("/private/project", "character", "Hero"),
    {
      command: "read_private_project_image",
      args: {
        projectPath: "/private/project",
        assetType: "character",
        assetName: "Hero",
      },
    },
  );
  for (const type of ["tileset", "autotile", "character"]) {
    assert.equal(
      privateImageReadRequest("/private/project", type, "Synthetic").args.assetType,
      type,
    );
  }
  for (const path of ["", "  ", "/private/project\0invalid"]) {
    assert.throws(() => privateImageReadRequest(path, "tileset", "Synthetic"), /project path/);
  }
  for (const type of ["bgm", "panorama", ""]) {
    assert.throws(() => privateImageReadRequest("/private/project", type, "Synthetic"), /image type/);
  }
  for (const name of ["", "../Synthetic", "folder/Synthetic", "folder\\Synthetic"]) {
    assert.throws(() => privateImageReadRequest("/private/project", "tileset", name), /image name/);
  }
});

test("private image cache keys distinguish roots and delimiter-containing names", () => {
  const key = (root, type, name) => privateImageCacheKey(0, root, type, name);
  assert.notEqual(key("/app/A", "tileset", "Town"), key("/app/B", "tileset", "Town"));
  assert.notEqual(
    key("/app/A:tileset:B", "character", "Hero"),
    key("/app/A", "tileset", "B:character:Hero"),
  );
  assert.equal(key("/app/A", "tileset", "Town"), key("/app/A", "tileset", "Town"));
});

test("simultaneous same-key reads share one boundary call and one decode", async () => {
  const { coordinator, calls, read, prepare, decode } = fixture();
  let releaseRead;
  const gate = new Promise((resolve) => { releaseRead = resolve; });
  const sharedRead = async (request) => {
    await gate;
    return read(request);
  };
  const pending = Array.from({ length: 100 }, () =>
    coordinator.load(
      "/private/project", "tileset", "Synthetic", sharedRead, prepare, decode,
    ),
  );
  assert.ok(pending.every((result) => result === pending[0]));
  releaseRead();
  const images = await Promise.all(pending);
  assert.equal(images.every((image) => image === images[0]), true);
  assert.deepEqual(calls, { read: 1, prepare: 1, decode: 1, release: 1, cached: 1 });
});

test("project switches logically cancel stale reads before decode or delivery", async () => {
  const { coordinator, calls, read, prepare } = fixture();
  let finishDecode;
  let decodeStarted;
  const started = new Promise((resolve) => { decodeStarted = resolve; });
  const gate = new Promise((resolve) => { finishDecode = resolve; });
  const decode = async (_src, _key, isCurrent) => {
    decodeStarted();
    await gate;
    if (isCurrent()) calls.cached++;
    return { width: 1, height: 1 };
  };
  const pending = coordinator.load(
    "/private/project", "tileset", "Synthetic", read, prepare, decode,
  );
  await started;
  coordinator.clear();
  finishDecode();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.cached, 0);
  assert.equal(calls.release, 1);
  assert.equal(coordinator.generation, 1);
});

test("project switches cancel an in-flight native read before image preparation", async () => {
  const { coordinator, calls, prepare, decode } = fixture();
  let finishRead;
  const gate = new Promise((resolve) => { finishRead = resolve; });
  const read = async () => {
    calls.read++;
    await gate;
    return syntheticPngDataUrl;
  };
  const pending = coordinator.load(
    "/private/project", "tileset", "Synthetic", read, prepare, decode,
  );
  await Promise.resolve();
  await Promise.resolve();
  coordinator.clear();
  finishRead();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls.prepare, 0);
  assert.equal(calls.decode, 0);
});

test("failed native reads preserve clear errors and are retryable", async () => {
  const { coordinator, prepare, decode } = fixture();
  let attempts = 0;
  const read = async () => {
    attempts++;
    if (attempts === 1) throw new Error("private project image not found");
    return syntheticPngDataUrl;
  };
  await assert.rejects(
    coordinator.load("/private/project", "tileset", "Synthetic", read, prepare, decode),
    /private project image not found/,
  );
  const image = await coordinator.load(
    "/private/project", "tileset", "Synthetic", read, prepare, decode,
  );
  assert.equal(image.width, 1);
  assert.equal(attempts, 2);
});

test("rejects malformed or oversized native payloads with actionable errors", async () => {
  const { coordinator, prepare, decode } = fixture();
  const read = async () => "data:image/png;base64,not base64";
  await assert.rejects(
    coordinator.load("/private/project", "tileset", "Synthetic", read, prepare, decode),
    /invalid base64 image data/,
  );

  const encodedLimit = 4 * Math.ceil(MAX_PRIVATE_IMAGE_BYTES / 3);
  const oversized = `data:image/png;base64,${"A".repeat(encodedLimit + 4)}`;
  await assert.rejects(
    coordinator.load(
      "/private/project", "tileset", "Synthetic",
      async () => oversized, prepare, decode,
    ),
    /32 MiB per-image limit/,
  );
});

test("decoded-image memory cap does not retain oversized synthetic images", () => {
  const cache = new DecodedImageCache(4, 12);
  cache.set("small", { width: 3, height: 4 });
  cache.set("large", { width: 4, height: 4 });
  assert.equal(cache.get("small")?.width, 3);
  assert.equal(cache.get("large"), undefined);
  assert.equal(cache.pixelCount, 12);
});

test("releases prepared image sources when decode fails", async () => {
  const { coordinator, calls, read, prepare } = fixture();
  await assert.rejects(
    coordinator.load(
      "/private/project",
      "tileset",
      "Synthetic",
      read,
      prepare,
      async () => { throw new Error("Synthetic image could not be decoded"); },
    ),
    /Synthetic image could not be decoded/,
  );
  assert.equal(calls.release, 1);
});
