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
    const expectedTiles = map.width * map.height * 3;
    if (
      map.id !== candidate.edit_map_id ||
      !Number.isSafeInteger(map.width) || map.width <= 0 ||
      !Number.isSafeInteger(map.height) || map.height <= 0 ||
      !Number.isSafeInteger(map.tileset_id) || map.tileset_id <= 0 ||
      !Number.isSafeInteger(expectedTiles) ||
      expectedTiles <= 0 ||
      expectedTiles > 30_000_000 ||
      !Array.isArray(map.tiles) ||
      map.tiles.length !== expectedTiles ||
      !map.tiles.every((tile) => Number.isInteger(tile) && tile >= -32768 && tile <= 32767)
    ) {
      throw new Error("Project's initial XP map has invalid three-layer tile data");
    }
    const tileset = await io.loadTileset(candidate.path, map.tileset_id);
    if (!tileset || tileset.id !== map.tileset_id) {
      throw new Error("Project's initial XP map refers to a mismatched tileset");
    }
    initialMap = map;
    initialTileset = tileset;
  }
  return { project: candidate, initialMap, initialTileset };
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

