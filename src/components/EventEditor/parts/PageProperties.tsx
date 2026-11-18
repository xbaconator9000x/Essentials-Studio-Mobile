import { useState } from "react";
import type { EventPage } from "../../../types";
import {
  EVENT_TRIGGERS,
  MOVE_TYPES,
} from "../../../types";
import { MOVE_COMMAND_NAMES } from "../../../services/eventCommands";
import { MoveRouteEditor } from "../MoveRouteEditor";
import { CharacterPicker } from "../CharacterPicker";
import { AssetPicker } from "../../shared/AssetPicker";
import { SpritePreview } from "./SpritePreview";
import { EditableCondition, NamedIdSelector, NumberInput, ToggleBadge } from "./fields";

export function PageProperties({ page, onUpdatePage, projectPath, switchNames, variableNames }: { page: EventPage; onUpdatePage: (updater: (p: EventPage) => EventPage) => void; projectPath: string; switchNames: string[]; variableNames: string[] }) {
  const [showMoveRoute, setShowMoveRoute] = useState(false);
  const [showCharPicker, setShowCharPicker] = useState(false);

  const updateCondition = (field: string, value: unknown) => {
    onUpdatePage((p) => ({
      ...p,
      condition: { ...p.condition, [field]: value },
    }));
  };

  const updateGraphic = (field: string, value: unknown) => {
    onUpdatePage((p) => ({
      ...p,
      graphic: { ...p.graphic, [field]: value },
    }));
  };

  const chooseCharacter = (name: string) => {
    // RMXP tile and character graphics are mutually exclusive. Preserve
    // existing tile graphics until the user explicitly chooses a character.
    onUpdatePage(current => ({ ...current, graphic: {
      ...current.graphic, character_name: name, tile_id: 0,
    } }));
  };

  return (
    <>
      {/* Conditions */}
      <div className="prop-section">
        <div className="prop-section-title">Conditions</div>
        <EditableCondition
          active={page.condition.switch1_valid}
          onToggle={() => updateCondition("switch1_valid", !page.condition.switch1_valid)}
          label="Switch 1"
        >
          <NamedIdSelector
            value={page.condition.switch1_id}
            onChange={(v) => updateCondition("switch1_id", v)}
            names={switchNames}
            label="Switch 1 ID"
          />
        </EditableCondition>
        <EditableCondition
          active={page.condition.switch2_valid}
          onToggle={() => updateCondition("switch2_valid", !page.condition.switch2_valid)}
          label="Switch 2"
        >
          <NamedIdSelector
            value={page.condition.switch2_id}
            onChange={(v) => updateCondition("switch2_id", v)}
            names={switchNames}
            label="Switch 2 ID"
          />
        </EditableCondition>
        <EditableCondition
          active={page.condition.variable_valid}
          onToggle={() => updateCondition("variable_valid", !page.condition.variable_valid)}
          label="Variable"
        >
          <NamedIdSelector
            value={page.condition.variable_id}
            onChange={(v) => updateCondition("variable_id", v)}
            names={variableNames}
            label="Variable ID"
          />
          <span style={{ color: "#8c8fa1", fontSize: 10 }}>&gt;=</span>
          <NumberInput label="Minimum variable value" value={page.condition.variable_value} onChange={(v) => updateCondition("variable_value", v)} />
        </EditableCondition>
        <EditableCondition
          active={page.condition.self_switch_valid}
          onToggle={() => updateCondition("self_switch_valid", !page.condition.self_switch_valid)}
          label="Self Switch"
        >
          <select
            className="prop-select"
            aria-label="Self switch letter"
            value={page.condition.self_switch_ch}
            onChange={(e) => updateCondition("self_switch_ch", e.target.value)}
          >
            {["A", "B", "C", "D"].map((ch) => (
              <option key={ch} value={ch}>{ch}</option>
            ))}
          </select>
        </EditableCondition>
      </div>

      {/* Graphic */}
      <div className="prop-section">
        <div className="prop-section-title">Graphic</div>
        <div className="prop-row">
          <button type="button"
            className="event-graphic-preview"
            onClick={() => setShowCharPicker(true)}
            aria-label="Browse event character graphics"
            title="Browse event character graphics"
          >
            <SpritePreview
              projectPath={projectPath}
              characterName={page.graphic.character_name}
              direction={page.graphic.direction}
              pattern={page.graphic.pattern}
              tileId={page.graphic.tile_id}
            />
          </button>
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", gap: 4, marginBottom: 4, alignItems: "center" }}>
              <AssetPicker
                projectPath={projectPath}
                assetType="character"
                value={page.graphic.character_name}
                label="Event character graphic"
                onChange={chooseCharacter}
                noneLabel="(no graphic)"
                className="prop-select"
              />
              <button
                className="event-editor-btn"
                style={{ padding: "2px 6px", fontSize: 10 }}
                onClick={() => setShowCharPicker(true)}
                title="Browse characters"
                aria-label="Open character browser"
              >
                Browse
              </button>
            </div>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{ fontSize: 10, color: "#8c8fa1" }}>Dir:</span>
              <select
                className="prop-select"
                aria-label="Character facing direction"
                value={page.graphic.direction}
                onChange={(e) => updateGraphic("direction", Number(e.target.value))}
              >
                <option value={2}>Down</option>
                <option value={4}>Left</option>
                <option value={6}>Right</option>
                <option value={8}>Up</option>
              </select>
              <span style={{ fontSize: 10, color: "#8c8fa1" }}>Opacity:</span>
              <NumberInput label="Character opacity" value={page.graphic.opacity} onChange={(v) => updateGraphic("opacity", v)} min={0} max={255} />
            </div>
          </div>
        </div>
        <div className="prop-row">
          <span className="prop-label">Frame</span>
          <select className="prop-select" aria-label="Character animation frame" value={page.graphic.pattern}
            onChange={e => updateGraphic("pattern", Number(e.currentTarget.value))}>
            {Array.from({length: 4}, (_, index) => <option value={index} key={index}>{index + 1}/4</option>)}
          </select>
        </div>
        <div className="prop-row">
          <span className="prop-label">Hue</span>
          <NumberInput label="Character hue" min={0} max={360} value={page.graphic.character_hue}
            onChange={value => updateGraphic("character_hue", value)} />
        </div>
        <div className="prop-row">
          <span className="prop-label">Blend</span>
          <select className="prop-select" aria-label="Character blend mode" value={page.graphic.blend_type}
            onChange={e => updateGraphic("blend_type", Number(e.currentTarget.value))}>
            <option value={0}>Normal</option><option value={1}>Additive</option><option value={2}>Subtractive</option>
          </select>
        </div>
        {page.graphic.tile_id > 0 && <div className="prop-row">
          <span className="prop-label">Tile graphic</span>
          <NumberInput label="Event graphic tile ID" min={0} value={page.graphic.tile_id}
            onChange={value => onUpdatePage(current => ({...current, graphic: {...current.graphic,
              tile_id: value, character_name: value > 0 ? "" : current.graphic.character_name}}))} />
        </div>}
        {showCharPicker && (
          <CharacterPicker
            projectPath={projectPath}
            currentName={page.graphic.character_name}
            currentDirection={page.graphic.direction}
            onSelect={chooseCharacter}
            onClose={() => setShowCharPicker(false)}
          />
        )}
      </div>

      {/* Movement */}
      <div className="prop-section">
        <div className="prop-section-title">Movement</div>
        <div className="prop-row">
          <span className="prop-label">Type</span>
          <select
            className="prop-select"
            aria-label="Event movement type"
            value={page.move_type}
            onChange={(e) => onUpdatePage((p) => ({ ...p, move_type: Number(e.target.value) }))}
          >
            {Object.entries(MOVE_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="prop-row">
          <span className="prop-label">Speed</span>
          <NumberInput
            label="Event movement speed"
            value={page.move_speed}
            onChange={(v) => onUpdatePage((p) => ({ ...p, move_speed: v }))}
            min={1} max={6}
          />
        </div>
        <div className="prop-row">
          <span className="prop-label">Frequency</span>
          <NumberInput
            label="Event movement frequency"
            value={page.move_frequency}
            onChange={(v) => onUpdatePage((p) => ({ ...p, move_frequency: v }))}
            min={1} max={6}
          />
        </div>

        {page.move_type === 3 && (
          <>
            <button
              className="event-editor-btn"
              style={{ padding: "3px 8px", fontSize: 10, marginTop: 4, width: "100%" }}
              onClick={() => setShowMoveRoute(true)}
            >
              Edit Move Route ({page.move_route.list.length - 1} cmd{page.move_route.list.length - 1 !== 1 ? "s" : ""})
            </button>
            {page.move_route.list.length > 1 && (
              <div className="move-route-list">
                {page.move_route.list.slice(0, 5).map((mc, i) =>
                  mc.code === 0 ? null : (
                    <div key={i} className="move-route-item">
                      {MOVE_COMMAND_NAMES[mc.code] ?? `Code ${mc.code}`}
                    </div>
                  )
                )}
                {page.move_route.list.length > 6 && (
                  <div className="move-route-item" style={{ color: "#8c8fa1" }}>
                    ...and {page.move_route.list.length - 6} more
                  </div>
                )}
              </div>
            )}
            {showMoveRoute && (
              <MoveRouteEditor
                projectPath={projectPath}
                moveRoute={page.move_route}
                onChange={(route) => onUpdatePage((p) => ({ ...p, move_route: route }))}
                onClose={() => setShowMoveRoute(false)}
              />
            )}
          </>
        )}
      </div>

      {/* Options */}
      <div className="prop-section">
        <div className="prop-section-title">Options</div>
        {(
          [
            ["walk_anime", "Walk Anime"],
            ["step_anime", "Step Anime"],
            ["direction_fix", "Direction Fix"],
            ["through", "Through"],
            ["always_on_top", "Always on Top"],
          ] as [keyof EventPage, string][]
        ).map(([field, label]) => (
          <div className="prop-row" key={field}>
            <span className="prop-label">{label}</span>
            <ToggleBadge
              label={label}
              on={page[field] as boolean}
              onToggle={() => onUpdatePage((p) => ({ ...p, [field]: !p[field] }))}
            />
          </div>
        ))}
      </div>

      {/* Trigger */}
      <div className="prop-section">
        <div className="prop-section-title">Trigger</div>
        <div className="prop-row">
          <select
            className="prop-select prop-select-wide"
            aria-label="Event trigger"
            value={page.trigger}
            onChange={(e) => onUpdatePage((p) => ({ ...p, trigger: Number(e.target.value) }))}
          >
            {Object.entries(EVENT_TRIGGERS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
      </div>
    </>
  );
}
