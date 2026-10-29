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
export async function inspectProjectBeforeOpen(
  path: string,
  io: {
    openProject: (path: string) => Promise<ProjectInfo>;
    loadMap: (projectPath: string, mapId: number) => Promise<MapRenderData>;
    loadTileset: (projectPath: string, tilesetId: number) => Promise<TilesetRenderInfo>;
  },
): Promise<ProjectInfo> {
  const candidate = await io.openProject(path);
  if (!candidate.path) {
    throw new Error("Project did not return a valid path");
  }
  if (candidate.edit_map_id > 0) {
    const map = await io.loadMap(candidate.path, candidate.edit_map_id);
    const expectedTiles = map.width * map.height * 3;
    if (
      map.id !== candidate.edit_map_id ||
      !Number.isSafeInteger(expectedTiles) ||
      expectedTiles <= 0 ||
      expectedTiles > 30_000_000 ||
      map.tiles.length !== expectedTiles
    ) {
      throw new Error("Project's initial XP map has invalid three-layer tile data");
    }
    await io.loadTileset(candidate.path, map.tileset_id);
  }
  return candidate;
}
