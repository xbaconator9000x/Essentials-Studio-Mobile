import type { EventInfo } from "../../types";

interface Props {
  events: EventInfo[];
  onOpenEvent?: (eventId: number, eventName: string) => void;
  onClose: () => void;
}

export function MapEventList({ events, onOpenEvent, onClose }: Props) {
  return (
    <section id="map-event-list" className="map-event-list" aria-label="Map events">
      <header className="map-event-list-header">
        <h2>Events on this map ({events.length})</h2>
        <button type="button" aria-label="Close map events" onClick={onClose}>Close</button>
      </header>
      <ul>
        {events.length === 0 ? (
          <li className="map-event-list-empty" role="status">No events on this map.</li>
        ) : events.map((event) => (
          <li key={event.id}>
            <button
              type="button"
              className="map-event-list-item"
              disabled={!onOpenEvent}
              onClick={() => onOpenEvent?.(event.id, event.name)}
            >
              <span className="map-event-list-name">
                [{String(event.id).padStart(3, "0")}] {event.name || "Unnamed event"}
              </span>
              <span className="map-event-list-position">({event.x}, {event.y})</span>
              <span className="map-event-list-pages">{event.page_count} pages</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
