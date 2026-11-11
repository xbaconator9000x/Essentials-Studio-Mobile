import { useMemo, useState } from "react";
import type { EventInfo } from "../../types";

interface Props {
  events: EventInfo[];
  onOpenEvent?: (eventId: number, eventName: string) => void;
  onCopyEvent?: (eventId: number) => Promise<void>;
  onFocusEvent?: (eventId: number) => void;
  onClose: () => void;
}

export function MapEventList({ events, onOpenEvent, onCopyEvent, onFocusEvent, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [sortBy, setSortBy] = useState<"id" | "name" | "position">("id");
  const [descending, setDescending] = useState(false);
  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = normalizedQuery ? events.filter((event) => (
      event.name.toLocaleLowerCase().includes(normalizedQuery)
      || event.graphic_name.toLocaleLowerCase().includes(normalizedQuery)
      || String(event.id).includes(normalizedQuery)
      || String(event.id).padStart(3, "0").includes(normalizedQuery)
      || `${event.x},${event.y}`.includes(normalizedQuery)
      || `${event.x} ${event.y}`.includes(normalizedQuery)
    )) : events;
    // Never mutate the native map's event order; sorting is presentation only.
    return [...filtered].sort((a, b) => {
      const direction = descending ? -1 : 1;
      if (sortBy === "name") return direction * (a.name.localeCompare(b.name) || a.id - b.id);
      if (sortBy === "position") return direction * (a.y - b.y || a.x - b.x || a.id - b.id);
      return direction * (a.id - b.id);
    });
  }, [events, query, sortBy, descending]);

  return (
    <section id="map-event-list" className="map-event-list" aria-label="Map events">
      <header className="map-event-list-header">
        <h2>Events on this map ({events.length})</h2>
        <button type="button" aria-label="Close map events" onClick={onClose}>Close</button>
      </header>
      <label className="map-event-list-search">
        <span className="map-event-list-search-label">Find an event</span>
        <input
          type="search"
          aria-label="Search map events by name, ID, or location"
          placeholder="Name, ID, or x,y"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query && (
          <button type="button" aria-label="Clear event search" onClick={() => setQuery("")}>
            Clear
          </button>
        )}
      </label>
      <div className="map-event-list-controls">
        <label>
          <span>Sort events</span>
          <select aria-label="Sort map events" value={sortBy}
            onChange={(event) => setSortBy(event.target.value as "id" | "name" | "position")}>
            <option value="id">Event ID</option>
            <option value="name">Name</option>
            <option value="position">Map position</option>
          </select>
        </label>
        <button type="button" aria-label={descending ? "Sort ascending" : "Sort descending"} aria-pressed={descending} onClick={() => setDescending((previous) => !previous)}>{descending ? "Descending" : "Ascending"}</button>
        <span aria-live="polite">{visibleEvents.length} of {events.length} events</span>
      </div>
      <ul>
        {events.length === 0 ? (
          <li className="map-event-list-empty" role="status">No events on this map.</li>
        ) : visibleEvents.length === 0 ? (
          <li className="map-event-list-empty" role="status">No map events match “{query.trim()}”.</li>
        ) : visibleEvents.map((event) => (
          <li key={event.id}>
            <div className="map-event-list-row">
              <button
                type="button"
                className="map-event-list-item"
                disabled={!onOpenEvent}
                onClick={() => {
                  onClose();
                  onOpenEvent?.(event.id, event.name);
                }}
              >
                <span className="map-event-list-name">
                  [{String(event.id).padStart(3, "0")}] {event.name || "Unnamed event"}
                </span>
                <span className="map-event-list-position">({event.x}, {event.y})</span>
                <span className="map-event-list-pages">{event.page_count} pages</span>
              </button>
              {onCopyEvent && (
                <button
                  type="button"
                  className="map-event-list-copy"
                  aria-label={`Copy event ${String(event.id).padStart(3, "0")} ${event.name || "Unnamed event"}`}
                  onClick={() => { void onCopyEvent(event.id); }}
                >
                  Copy
                </button>
              )}
              {onFocusEvent && (
                <button
                  type="button"
                  className="map-event-list-focus"
                  aria-label={`Locate event ${String(event.id).padStart(3, "0")} ${event.name || "Unnamed event"} on map`}
                  onClick={() => {
                    onClose();
                    onFocusEvent(event.id);
                  }}
                >
                  Locate
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
