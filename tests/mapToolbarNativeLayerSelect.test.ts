import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const toolbar = readFileSync(new URL("../src/components/MapEditor/MapToolbar.tsx", import.meta.url), "utf8");

describe("mobile map layer selector contract", () => {
  it("exposes all three RMXP tile layers, events and all-layers mode", () => {
    for (const entry of ['{ layer: 0,', '{ layer: 1,', '{ layer: 2,', '{ layer: 3,', '{ layer: -1,']) {
      expect(toolbar).toContain(entry);
    }
    expect(toolbar).toContain('aria-label="Select active map layer"');
    expect(toolbar).toContain('value={selectedLayer}');
    expect(toolbar).toContain('setSelectedLayer(Number(event.currentTarget.value))');
  });

  it("retains accessible shortcut buttons and existing desktop layer controls", () => {
    expect(toolbar).toContain('aria-expanded={quickLayersExpanded}');
    expect(toolbar).toContain('aria-label={name}');
    expect(toolbar).toContain('aria-label="Map layers"');
    expect(toolbar).toContain('aria-label="Quick map layers"');
  });
});
