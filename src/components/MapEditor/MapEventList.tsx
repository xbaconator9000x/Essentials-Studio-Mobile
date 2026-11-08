import { useMemo, useState } from "react";
import type { EventInfo } from "../../types";

interface Props {
  events: EventInfo[];
  onOpenEvent?: (eventId: number, eventName: string) => void;
  onFocusEvent?: (eventId: number) => void;
  onClose: () => void;
}

export function MapEventList({ events, onOpenEvent, onFocusEvent, onClose }: Props) {
  const [query, setQuery] = useState("");
  const visibleEvents = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return events;
    return events.filter((event) => (
      event.name.toLocaleLowerCase().includes(normalizedQuery)
      || String(event.id).includes(normalizedQuery)
      || String(event.id).padStart(3, "0").includes(normalizedQuery)
      || `${event.x},${event.y}`.includes(normalizedQuery)
      || `${event.x} ${event.y}`.includes(normalizedQuery)
    ));
  }, [events, query]);

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
