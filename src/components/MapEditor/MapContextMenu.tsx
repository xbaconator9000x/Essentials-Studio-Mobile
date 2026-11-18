import { useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";

interface ContextMenuState {
  x: number; // screen x
  y: number; // screen y
  tileX: number; // tile col
  tileY: number; // tile row
  event: { id: number; name: string } | null;
}

interface MapContextMenuProps {
  contextMenu: ContextMenuState;
  setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
  hasClipboardEvent?: boolean;
  onOpenEvent?: (eventId: number, eventName: string) => void;
  onCopyEvent?: (eventId: number) => Promise<void>;
  onDeleteEvent?: (eventId: number, eventName: string) => void;
  onPasteEvent?: (x: number, y: number) => Promise<void>;
  onCreateEvent?: (x: number, y: number) => void;
  onSetStartPosition?: (x: number, y: number) => Promise<void>;
}

export function MapContextMenu({
  contextMenu,
  setContextMenu,
  hasClipboardEvent,
  onOpenEvent,
  onCopyEvent,
  onDeleteEvent,
  onPasteEvent,
  onCreateEvent,
  onSetStartPosition,
}: MapContextMenuProps) {
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // If the user switches maps while a native write is in flight, its late
  // completion must not dismiss a context menu opened in the next map.
  const closeThisMenu = () =>
    setContextMenu((current) => current === contextMenu ? null : current);

  const runNativeAction = async (label: string, action: () => Promise<void>) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    try {
      await action();
      closeThisMenu();
    } catch (cause) {
      // Keep the menu available for retry and expose the failed native write.
      setActionError(`Could not ${label}: ${cause instanceof Error ? cause.message : String(cause)}`);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div
      className="map-tree-context-overlay"
      role="presentation"
      onClick={() => { if (!pendingRef.current) closeThisMenu(); }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (!pendingRef.current) closeThisMenu();
      }}
    >
      <div
        className="map-tree-context-menu"
        role="menu"
        aria-label={contextMenu.event ? "Event actions" : "Map tile actions"}
        style={{ left: contextMenu.x, top: contextMenu.y }}
        onClick={(e) => e.stopPropagation()}
      >
        {contextMenu.event && (
          <>
            <button type="button" role="menuitem" disabled={pending}
              onClick={() => {
                if (onOpenEvent) onOpenEvent(contextMenu.event!.id, contextMenu.event!.name);
                closeThisMenu();
              }}>
              Open Event
            </button>
            <button type="button" role="menuitem" disabled={pending}
              onClick={() => {
                if (onCopyEvent) void runNativeAction("copy event",
                  () => onCopyEvent(contextMenu.event!.id));
              }}>
              Copy Event
            </button>
            <div className="map-tree-context-separator" />
            <button type="button" role="menuitem" disabled={pending}
              className="map-tree-context-danger"
              onClick={() => {
                if (onDeleteEvent) onDeleteEvent(contextMenu.event!.id, contextMenu.event!.name);
                closeThisMenu();
              }}>
              Delete Event
            </button>
            <div className="map-tree-context-separator" />
          </>
        )}
        {!contextMenu.event && onCreateEvent && (
          <button type="button" role="menuitem" disabled={pending}
            onClick={() => {
              onCreateEvent(contextMenu.tileX, contextMenu.tileY);
              closeThisMenu();
            }}>New Event</button>
        )}
        {!contextMenu.event && hasClipboardEvent && (
          <>
            <button type="button" role="menuitem" disabled={pending}
              onClick={() => {
                if (onPasteEvent) void runNativeAction("paste event",
                  () => onPasteEvent(contextMenu.tileX, contextMenu.tileY));
              }}>
              Paste Event
            </button>
            <div className="map-tree-context-separator" />
          </>
        )}
        <button type="button" role="menuitem" disabled={pending}
          onClick={() => {
            if (onSetStartPosition) void runNativeAction("set starting point",
              () => onSetStartPosition(contextMenu.tileX, contextMenu.tileY));
          }}>
          Set as Starting Point
        </button>
        {pending && <span role="status">Completing action…</span>}
        {actionError && <span role="alert">{actionError}</span>}
      </div>
    </div>
  );
}
