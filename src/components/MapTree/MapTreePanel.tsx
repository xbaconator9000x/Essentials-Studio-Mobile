import { useCallback, useMemo, useRef, useState } from "react";
import type { MapInfo, MapTreeNode } from "../../types";
import { clampContextMenuPosition } from "../../services/mapGestures";
import "./MapTreePanel.css";

interface Props {
  mapInfos: Record<number, MapInfo>;
  currentMapId: number | null;
  onSelectMap: (id: number) => void;
  onCreateMap: (parentId: number) => void;
  onDeleteMap: (id: number, name: string) => void;
  onRenameMap: (id: number, currentName: string) => void;
  onMapProperties: (id: number) => void;
  readOnly?: boolean;
}

interface ContextMenuState {
  x: number;
  y: number;
  mapId: number;
  mapName: string;
}

/**
 * Hierarchical map tree panel with context menu.
 */
export function MapTreePanel({
  mapInfos,
  currentMapId,
  onSelectMap,
  onCreateMap,
  onDeleteMap,
  onRenameMap,
  onMapProperties,
  readOnly = false,
}: Props) {
  const tree = useMemo(() => buildTree(mapInfos), [mapInfos]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [mapSearch, setMapSearch] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchQuery = mapSearch.trim().toLocaleLowerCase();
  const visibleTree = useMemo(() => filterTree(tree, searchQuery), [tree, searchQuery]);

  // Expansion state lives here (keyed by map id) rather than inside each node so
  // it survives tree rebuilds when mapInfos changes (create/rename/delete).
  const [expandedIds, setExpandedIds] = useState<Set<number>>(() => {
    const s = new Set<number>();
    for (const [idStr, info] of Object.entries(mapInfos)) {
      if (info.expanded) s.add(Number(idStr));
    }
    return s;
  });

  const forcedExpandedIds = useMemo(() => {
    const ids = new Set<number>();
    addParentIds(visibleTree, ids);
    if (currentMapId !== null) {
      for (const id of getAncestorIds(currentMapId, mapInfos)) ids.add(id);
    }
    return ids;
  }, [visibleTree, currentMapId, mapInfos]);
  const visibleExpandedIds = useMemo(
    () => new Set([...expandedIds, ...forcedExpandedIds]),
    [expandedIds, forcedExpandedIds],
  );

  const toggleExpanded = useCallback((id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, mapId: number, mapName: string) => {
      e.preventDefault();
      e.stopPropagation();
      const { x, y } = clampContextMenuPosition(
        { x: e.clientX, y: e.clientY }, window.innerWidth, window.innerHeight,
        200, 320, 8,
      );
      setContextMenu({ x, y, mapId, mapName });
    },
    []
  );

  const closeMenu = useCallback(() => setContextMenu(null), []);

  const handleMenuAction = useCallback(
    (action: string) => {
      if (!contextMenu) return;
      closeMenu();
      switch (action) {
        case "open":
          onSelectMap(contextMenu.mapId);
          break;
        case "properties":
          onMapProperties(contextMenu.mapId);
          break;
        case "create":
          onCreateMap(contextMenu.mapId);
          break;
        case "rename":
          onRenameMap(contextMenu.mapId, contextMenu.mapName);
          break;
        case "delete":
          onDeleteMap(contextMenu.mapId, contextMenu.mapName);
          break;
      }
    },
    [contextMenu, closeMenu, onSelectMap, onCreateMap, onDeleteMap, onRenameMap, onMapProperties]
  );

  return (
    <div className="map-tree-panel" onClick={closeMenu}>
      <div className="map-tree-header">
        <span>Maps</span>
        {!readOnly && <button
          className="map-tree-add-btn"
          title="Create new map"
          onClick={(e) => {
            e.stopPropagation();
            onCreateMap(0);
          }}
        >
          +
        </button>}
      </div>
      <label className="map-tree-search">
        <span className="map-tree-search-label">Find a map</span>
        <input
          type="search"
          aria-label="Search maps by name or ID"
          placeholder="Name or map ID"
          value={mapSearch}
          onChange={(event) => setMapSearch(event.target.value)}
        />
        {mapSearch && (
          <button type="button" aria-label="Clear map search" onClick={() => setMapSearch("")}>
            Clear
          </button>
        )}
      </label>
      <div className="map-tree-list" role="tree" aria-label="Project maps">
        {visibleTree.length === 0 ? (
          <p className="map-tree-empty" role="status">No maps match “{mapSearch.trim()}”.</p>
        ) : visibleTree.map((node) => (
          <MapTreeNodeItem
            key={node.id}
            node={node}
            depth={0}
            currentMapId={currentMapId}
            onSelectMap={onSelectMap}
            onContextMenu={readOnly ? undefined : handleContextMenu}
            readOnly={readOnly}
            expandedIds={visibleExpandedIds}
            onToggle={toggleExpanded}
          />
        ))}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="map-tree-context-overlay"
          onClick={closeMenu}
          onContextMenu={(e) => { e.preventDefault(); closeMenu(); }}
        >
          <div
            ref={menuRef}
            className="map-tree-context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => handleMenuAction("open")}>Open Map</button>
            <button onClick={() => handleMenuAction("properties")}>Properties...</button>
            <div className="map-tree-context-separator" />
            <button onClick={() => handleMenuAction("create")}>New Child Map...</button>
            <button onClick={() => handleMenuAction("rename")}>Rename...</button>
            <div className="map-tree-context-separator" />
            <button className="map-tree-context-danger" onClick={() => handleMenuAction("delete")}>
              Delete Map
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function MapTreeNodeItem({
  node,
  depth,
  currentMapId,
  onSelectMap,
  onContextMenu,
  readOnly,
  expandedIds,
  onToggle,
}: {
  node: MapTreeNode;
  depth: number;
  currentMapId: number | null;
  onSelectMap: (id: number) => void;
  onContextMenu?: (e: React.MouseEvent, id: number, name: string) => void;
  readOnly: boolean;
  expandedIds: Set<number>;
  onToggle: (id: number) => void;
}) {
  const expanded = expandedIds.has(node.id);
  const hasChildren = node.children.length > 0;
  const isSelected = node.id === currentMapId;

  return (
    <div className="map-tree-node">
      <div
        className={`map-tree-item ${isSelected ? "selected" : ""}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        role="treeitem"
        tabIndex={0}
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
        onClick={() => onSelectMap(node.id)}
        onContextMenu={onContextMenu ? (e) => onContextMenu(e, node.id, node.name) : undefined}
        onDoubleClick={() => onSelectMap(node.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelectMap(node.id); }
          else if (e.key === "ArrowRight" && hasChildren && !expanded) onToggle(node.id);
          else if (e.key === "ArrowLeft" && hasChildren && expanded) onToggle(node.id);
        }}
      >
        {hasChildren && (
          <span
            className="map-tree-toggle"
            onClick={(e) => {
              e.stopPropagation();
              onToggle(node.id);
            }}
          >
            {expanded ? "▾" : "▸"}
          </span>
        )}
        {!hasChildren && <span className="map-tree-toggle-spacer" />}
        <span className="map-tree-icon">🗺</span>
        <span className="map-tree-name">
          [{String(node.id).padStart(3, "0")}] {node.name}
        </span>
        {!readOnly && onContextMenu && (
          <button type="button" className="map-tree-actions-button"
            aria-label={`Map actions for ${node.name}`}
            title={`Map actions for ${node.name}`}
            onClick={event => {
              event.stopPropagation();
              onContextMenu(event, node.id, node.name);
            }}>⋮</button>
        )}
      </div>
      {expanded &&
        hasChildren &&
        <div role="group">
          {node.children.map((child) => (
            <MapTreeNodeItem
              key={child.id}
              node={child}
              depth={depth + 1}
              currentMapId={currentMapId}
              onSelectMap={onSelectMap}
              onContextMenu={onContextMenu}
              readOnly={readOnly}
              expandedIds={expandedIds}
              onToggle={onToggle}
            />
          ))}
        </div>}
    </div>
  );
}

/**
 * Build a tree structure from flat MapInfos.
 */
function buildTree(mapInfos: Record<number, MapInfo>): MapTreeNode[] {
  const nodes: Map<number, MapTreeNode> = new Map();

  // Create nodes
  for (const [idStr, info] of Object.entries(mapInfos)) {
    const id = Number(idStr);
    nodes.set(id, {
      id,
      name: info.name,
      parent_id: info.parent_id,
      order: info.order,
      expanded: info.expanded,
      children: [],
    });
  }

  // Build tree
  const roots: MapTreeNode[] = [];
  for (const node of nodes.values()) {
    if (node.parent_id === 0) {
      roots.push(node);
    } else {
      const parent = nodes.get(node.parent_id);
      if (parent) {
        parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
  }

  // Sort by order
  const sortNodes = (nodes: MapTreeNode[]) => {
    nodes.sort((a, b) => a.order - b.order);
    for (const node of nodes) {
      sortNodes(node.children);
    }
  };
  sortNodes(roots);

  return roots;
}

function filterTree(nodes: MapTreeNode[], query: string): MapTreeNode[] {
  if (!query) return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    const matches = node.name.toLocaleLowerCase().includes(query)
      || String(node.id).includes(query)
      || String(node.id).padStart(3, "0").includes(query);
    return matches || children.length > 0 ? [{ ...node, children }] : [];
  });
}

function addParentIds(nodes: MapTreeNode[], expandedIds: Set<number>): void {
  for (const node of nodes) {
    if (node.children.length > 0) expandedIds.add(node.id);
    addParentIds(node.children, expandedIds);
  }
}

function getAncestorIds(mapId: number, mapInfos: Record<number, MapInfo>): Set<number> {
  const ancestors = new Set<number>();
  const visited = new Set<number>([mapId]);
  let parentId = mapInfos[mapId]?.parent_id;
  while (parentId && mapInfos[parentId] && !visited.has(parentId)) {
    ancestors.add(parentId);
    visited.add(parentId);
    parentId = mapInfos[parentId].parent_id;
  }
  return ancestors;
}
