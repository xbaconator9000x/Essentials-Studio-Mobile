import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../src/components/TilesetPalette/TilesetPalette.tsx", import.meta.url), "utf8");

test("recent tiles are invalidated when a project swaps tileset images without replacing metadata", () => {
  assert.match(source, /setRecentTileIds\(\[\]\);\s*\}, \[tilesetInfo, tilesetImage\]/);
});

test("recent shortcuts validate regular tile geometry and populated autotile slots", () => {
  assert.match(source, /const validRecentTiles = recentTileIds\.filter/);
  assert.match(source, /tileIdIsValid\(id\)/);
  assert.match(source, /autotile_names\[Math\.floor\(id \/ 48\) - 1\]/);
  assert.match(source, /validRecentTiles\.map\(id =>/);
});

test("autotile selections reuse the tracked recent-selection callback", () => {
  assert.match(source, /const handleAutotileClick = useCallback\([\s\S]*?selectTile\(tileId\);[\s\S]*?\[selectTile\]/);
});
