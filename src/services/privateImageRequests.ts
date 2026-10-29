import { InFlightImageLoads } from "./inFlightImageLoads.ts";

export type PrivateImageAssetType = "tileset" | "autotile" | "character";

export const MAX_PRIVATE_IMAGE_BYTES = 32 * 1024 * 1024;

export interface PrivateImageReadRequest {
  command: "read_private_project_image";
  args: {
    projectPath: string;
    assetType: PrivateImageAssetType;
    assetName: string;
  };
}

export interface PrivateImageSource {
  src: string;
  release: () => void;
}

export function privateImageReadRequest(
  projectPath: string,
  assetType: string,
  assetName: string,
): PrivateImageReadRequest {
  if (!projectPath.trim() || projectPath.includes("\0")) {
    throw new Error("Invalid private project path");
  }
  if (assetType !== "tileset" && assetType !== "autotile" && assetType !== "character") {
    throw new Error("Unsupported private project image type");
  }
  if (!assetName || assetName.includes("\0") || assetName.includes("/") || assetName.includes("\\") ||
      assetName.includes("..")) {
    throw new Error("Invalid private project image name");
  }

  return {
    command: "read_private_project_image",
    args: { projectPath, assetType, assetName },
  };
}

export function privateImageCacheKey(
  generation: number,
  projectPath: string,
  assetType: PrivateImageAssetType,
  assetName: string,
): string {
  return JSON.stringify(["private-image", generation, projectPath, assetType, assetName]);
}

export function validatePrivateImageDataUrl(dataUrl: string): void {
  if (typeof dataUrl !== "string") {
    throw new Error("Native image reader returned an invalid image data URL");
  }
  const base64DataUrl =
    /^data:image\/(?:png|jpeg|gif|bmp);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
  const separator = dataUrl.indexOf(",");
  if (separator < 0 || !/^data:image\/(?:png|jpeg|gif|bmp);base64,/.test(dataUrl)) {
    throw new Error("Native image reader returned an invalid image data URL");
  }

  const payloadLength = dataUrl.length - separator - 1;
  const maxBase64Length = 4 * Math.ceil(MAX_PRIVATE_IMAGE_BYTES / 3);
  if (!payloadLength || payloadLength > maxBase64Length) {
    throw new Error("Project image exceeds the 32 MiB per-image limit");
  }
  if (payloadLength % 4 !== 0 || !base64DataUrl.test(dataUrl)) {
    throw new Error("Native image reader returned invalid base64 image data");
  }

  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  if ((payloadLength / 4) * 3 - padding > MAX_PRIVATE_IMAGE_BYTES) {
    throw new Error("Project image exceeds the 32 MiB per-image limit");
  }
}

function assertCurrent(isCurrent: () => boolean): void {
  if (isCurrent()) return;
  const error = new Error("Project image request cancelled because the active project changed");
  error.name = "AbortError";
  throw error;
}

export class PrivateImageLoadCoordinator<T> {
  private readonly pending = new InFlightImageLoads<T>();
  private currentGeneration = 0;

  get generation(): number {
    return this.currentGeneration;
  }

  clear(): void {
    this.currentGeneration++;
  }

  load(
    projectPath: string,
    assetType: string,
    assetName: string,
    read: (request: PrivateImageReadRequest) => Promise<string>,
    prepare: (dataUrl: string) => Promise<PrivateImageSource>,
    decode: (src: string, cacheKey: string, isCurrent: () => boolean) => Promise<T>,
  ): Promise<T> {
    const request = privateImageReadRequest(projectPath, assetType, assetName);
    const generation = this.currentGeneration;
    const cacheKey = privateImageCacheKey(
      generation,
      projectPath,
      request.args.assetType,
      assetName,
    );
    const isCurrent = () => generation === this.currentGeneration;

    return this.pending.run(cacheKey, async () => {
      assertCurrent(isCurrent);
      let dataUrl = await read(request);
      assertCurrent(isCurrent);
      validatePrivateImageDataUrl(dataUrl);

      const source = await prepare(dataUrl);
      dataUrl = "";
      try {
        assertCurrent(isCurrent);
        const result = await decode(source.src, cacheKey, isCurrent);
        assertCurrent(isCurrent);
        return result;
      } finally {
        source.release();
      }
    });
  }
}
