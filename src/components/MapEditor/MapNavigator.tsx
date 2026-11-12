import { useMemo, useState } from "react";
import type { EventInfo } from "../../types";
import { parseMapCoordinate } from "../../services/mapCoordinateNavigation";
import type { MapEventPlacementMode } from "../../services/mapEventPlacement";

interface Props {
  mapWidth: number;
  mapHeight: number;
  events: readonly EventInfo[];
  startTile?: { x: number; y: number };
  initialTile?: { x: number; y: number } | null;
  readOnly?: boolean;
  canCreateEvent: boolean;
  canPasteEvent: boolean;
  eventPlacementPending: boolean;
  eventPlacementMessage?: string | null;
  onNavigate: (point: { x: number; y: number }) => void;
  onPlaceEvent: (mode: MapEventPlacementMode, point: { x: number; y: number }) => void;
  onOpenEvent?: (eventId: number, name: string) => void;
  onClose: () => void;
}

/** Touch-first coordinate navigation: it never edits a map tile or the native
 * event array directly. All event operations delegate to the project bridge. */
export function MapNavigator({
  mapWidth, mapHeight, events, startTile, initialTile, readOnly = false,
  canCreateEvent, canPasteEvent, eventPlacementPending,
  eventPlacementMessage, onNavigate, onPlaceEvent, onOpenEvent, onClose,
}: Props) {
  const [xText, setXText] = useState(String(initialTile?.x ?? 0));
  const [yText, setYText] = useState(String(initialTile?.y ?? 0));
  const coordinate = useMemo(
    () => parseMapCoordinate(xText, yText, mapWidth, mapHeight),
    [xText, yText, mapWidth, mapHeight],
  );
  const occupied = coordinate
    ? events.find(event => event.x === coordinate.x && event.y === coordinate.y)
    : undefined;
  const validStart = startTile
    ? parseMapCoordinate(String(startTile.x), String(startTile.y), mapWidth, mapHeight)
    : null;

  const jump = (point: { x: number; y: number }) => {
    setXText(String(point.x));
    setYText(String(point.y));
    onNavigate(point);
  };

  return (
    <section id="map-coordinate-navigator" className="map-coordinate-navigator"
      aria-label="Map coordinate navigator">
      <header>
        <strong>Navigate map tiles</strong>
        <button type="button" aria-label="Close coordinate navigator" onClick={onClose}>Close</button>
      </header>
      <p className="map-navigator-range">X: 0–{Math.max(0, mapWidth - 1)} · Y: 0–{Math.max(0, mapHeight - 1)}</p>
      <form onSubmit={event => { event.preventDefault(); if (coordinate) onNavigate(coordinate); }}>
        <label>
          X
          <input aria-label="Map tile X coordinate" type="text" inputMode="numeric"
            autoComplete="off" value={xText} onChange={event => setXText(event.target.value)} />
        </label>
        <label>
          Y
          <input aria-label="Map tile Y coordinate" type="text" inputMode="numeric"
            autoComplete="off" value={yText} onChange={event => setYText(event.target.value)} />
        </label>
        <button type="submit" disabled={!coordinate} aria-label="Go to map coordinates">Go</button>
      </form>
      {!coordinate && <p role="status">Enter whole-number coordinates inside the map.</p>}
      {occupied && coordinate && (
        <div className="map-navigator-event">
          <span>Event [{String(occupied.id).padStart(3, "0")}]: {occupied.name || "Unnamed event"}</span>
          {onOpenEvent && <button type="button" onClick={() => onOpenEvent(occupied.id, occupied.name)}>
            Edit event
          </button>}
        </div>
      )}
      {coordinate && !occupied && <p className="map-navigator-range">Tile ({coordinate.x}, {coordinate.y}) is empty of events.</p>}
      {!readOnly && (
        <div className="map-navigator-actions" role="group" aria-label="Coordinate event actions">
          {canCreateEvent && <button type="button" disabled={!coordinate || !!occupied || eventPlacementPending}
            aria-label="Create event at coordinates"
            onClick={() => { if (coordinate) onPlaceEvent("create", coordinate); }}>New event here</button>}
          {canPasteEvent && <button type="button" disabled={!coordinate || !!occupied || eventPlacementPending}
            aria-label="Paste event at coordinates"
            onClick={() => { if (coordinate) onPlaceEvent("paste", coordinate); }}>Paste event here</button>}
        </div>
      )}
      {eventPlacementPending && <p role="status">Saving event…</p>}
      {eventPlacementMessage && <p role="alert">{eventPlacementMessage}</p>}
      {validStart && (
        <button type="button" className="map-navigator-start" aria-label="Go to player start"
          onClick={() => jump(validStart)}>Player start ({validStart.x}, {validStart.y})</button>
      )}
      {events.length > 0 && (
        <label className="map-navigator-event-picker">
          Locate existing event
          <select aria-label="Jump to existing map event" value=""
            onChange={event => {
              const id = Number(event.currentTarget.value);
              const selected = events.find(candidate => candidate.id === id);
              if (selected) jump({ x: selected.x, y: selected.y });
            }}>
            <option value="">Choose event…</option>
            {events.map(event => (
              <option key={event.id} value={event.id}>
                [{String(event.id).padStart(3, "0")}] {event.name || "Unnamed event"} ({event.x}, {event.y})
              </option>
            ))}
          </select>
        </label>
      )}
    </section>
  );
}
