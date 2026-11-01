import type { MapRenderData, ProjectInfo, TilesetRenderInfo } from "../types";

/**
 * Validate the initial map and its tileset before replacing the active editor
 * project. A syntactically valid Game.rxproj/System.rxdata is not enough:
 * the old project must remain selected if an imported ZIP has a broken
 * initial MapNNN.rxdata or missing Tilesets.rxdata.
 *
 * This is a read-only probe. It deliberately does not save, rewrite, or
 * normalize any RXDATA, PBS, scripts, or graphics.
 */
export async function prepareProjectBeforeOpen(
  path: string,
  io: {
    openProject: (path: string) => Promise<ProjectInfo>;
    loadMap: (projectPath: string, mapId: number) => Promise<MapRenderData>;
    loadTileset: (projectPath: string, tilesetId: number) => Promise<TilesetRenderInfo>;
  },
): Promise<{ project: ProjectInfo; initialMap: MapRenderData | null; initialTileset: TilesetRenderInfo | null }> {
  const candidate = await io.openProject(path);
  if (typeof candidate.path !== "string" || !candidate.path.trim()) {
    throw new Error("Project did not return a valid path");
  }
  if (!Number.isSafeInteger(candidate.edit_map_id) || candidate.edit_map_id < 0) {
    throw new Error("Project returned an invalid initial XP map ID");
  }
  let initialMap: MapRenderData | null = null;
  let initialTileset: TilesetRenderInfo | null = null;
  if (candidate.edit_map_id > 0) {
    const map = await io.loadMap(candidate.path, candidate.edit_map_id);
    assertValidXpMap(map, candidate.edit_map_id);
    const tileset = await io.loadTileset(candidate.path, map.tileset_id);
    if (!tileset || tileset.id !== map.tileset_id) {
      throw new Error("Project's initial XP map refers to a mismatched tileset");
    }
    initialMap = map;
    initialTileset = tileset;
  }
  return { project: candidate, initialMap, initialTileset };
}

/**
 * Validate every map before exposing it to the editor, not just the first
 * map opened after import. A broken second map must not replace a valid
 * three-layer buffer or leave its old map ID attached to new tiles.
 */
function assertValidXpMap(map: MapRenderData, expectedId: number): void {
  const expectedTiles = map.width * map.height * 3;
  if (
    map.id !== expectedId ||
    !Number.isSafeInteger(map.width) || map.width <= 0 ||
    !Number.isSafeInteger(map.height) || map.height <= 0 ||
    !Number.isSafeInteger(map.tileset_id) || map.tileset_id <= 0 ||
    !Number.isSafeInteger(expectedTiles) || expectedTiles <= 0 ||
    expectedTiles > 30_000_000 ||
    !Array.isArray(map.tiles) || map.tiles.length !== expectedTiles ||
    !map.tiles.every(tile => Number.isInteger(tile) && tile >= -32768 && tile <= 32767)
  ) {
    throw new Error("XP map has invalid three-layer tile data");
  }
}

export type LoadedMapImages = {
  tileset: HTMLImageElement | null;
  autotiles: (HTMLImageElement | null)[];
};

/** Read and validate the entire map/tileset/image set before committing any
 * React state. A failed native read or Android asset load leaves the previous
 * map, event overlay, and dirty tile buffer untouched.
 */
export async function prepareMapSelection(
  projectPath: string,
  mapId: number,
  io: {
    loadMap: (path: string, id: number) => Promise<MapRenderData>;
    loadTileset: (path: string, id: number) => Promise<TilesetRenderInfo>;
    loadImages: (path: string, tilesetName: string, autotileNames: string[]) => Promise<LoadedMapImages>;
  },
): Promise<{ map: MapRenderData; tileset: TilesetRenderInfo; images: LoadedMapImages }> {
  if (!Number.isSafeInteger(mapId) || mapId <= 0) {
    throw new Error("Invalid XP map selection ID");
  }
  const map = await io.loadMap(projectPath, mapId);
  assertValidXpMap(map, mapId);
  const tileset = await io.loadTileset(projectPath, map.tileset_id);
  if (!tileset || tileset.id !== map.tileset_id || !Array.isArray(tileset.autotile_names)) {
    throw new Error("Selected XP map has a missing or mismatched tileset");
  }
  const images = await io.loadImages(projectPath, tileset.tileset_name, tileset.autotile_names);
  if (!images || !Array.isArray(images.autotiles) ||
      (tileset.tileset_name && !images.tileset)) {
    throw new Error("Selected XP map's required tileset graphic did not load");
  }
  return { map, tileset, images };
}

/** A same-map refresh (e.g. after editing event dialogue) must not discard
 * unsaved tile painting. Keep local cells but use freshly loaded event data.
 * Refuse an incompatible resize rather than applying cells to wrong coordinates.
 */
export function preserveUnsavedMapTiles(
  fresh: MapRenderData,
  previous: MapRenderData | null,
  preserve: boolean,
): MapRenderData {
  if (!preserve) return fresh;
  if (!previous || previous.id !== fresh.id ||
      previous.width !== fresh.width || previous.height !== fresh.height ||
      previous.tiles.length !== fresh.tiles.length) {
    throw new Error("Cannot reload resized map while unsaved tile edits exist; save tiles first");
  }
  return { ...fresh, tiles: [...previous.tiles] };
}

/** Legacy read-only preflight API retained for existing callers/tests. */
export async function inspectProjectBeforeOpen(
  path: string,
  io: {
    openProject: (path: string) => Promise<ProjectInfo>;
    loadMap: (projectPath: string, mapId: number) => Promise<MapRenderData>;
    loadTileset: (projectPath: string, tilesetId: number) => Promise<TilesetRenderInfo>;
  },
): Promise<ProjectInfo> {
  return (await prepareProjectBeforeOpen(path, io)).project;
}


/**
 * A project-open request may finish after a newer request (especially when
 * loading Android private graphics). Only the latest request may activate its
 * project or publish late PBS/tileset/system metadata.
 */
export class ProjectOpenCoordinator {
  private generation = 0;

  begin(): { isCurrent: () => boolean; assertCurrent: () => void } {
    const generation = ++this.generation;
    const isCurrent = () => this.generation === generation;
    return {
      isCurrent,
      assertCurrent: () => {
        if (!isCurrent()) {
          throw new Error("Project open superseded by a newer request");
        }
      },
    };
  }
}
