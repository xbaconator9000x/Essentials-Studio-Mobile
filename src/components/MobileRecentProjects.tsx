import { useState } from "react";
import "./MobileRecentProjects.css";

interface Props {
  paths: string[];
  currentPath: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}

function projectSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean);
}

/** A project basename and even its parent folder can be duplicated across
 * storage providers. Use the shortest suffix that distinguishes each path. */
function projectLabels(paths: readonly string[]): string[] {
  const segments = paths.map(projectSegments);
  return paths.map((path, index) => {
    const own = segments[index];
    if (own.length === 0) return path || "Project";
    for (let length = 1; length <= own.length; length++) {
      const candidate = own.slice(-length).join("/");
      if (segments.every((parts, other) =>
        other === index || parts.slice(-length).join("/") !== candidate)) {
        return candidate;
      }
    }
    // Distinct provider roots can have the same visible path segments.
    return path;
  });
}

export function MobileRecentProjects({ paths, currentPath, disabled, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const uniquePaths = [...new Set(paths)];
  if (uniquePaths.length < 2) return null;
  const labels = projectLabels(uniquePaths);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visiblePaths = uniquePaths.filter((path, index) =>
    !normalizedQuery || labels[index].toLocaleLowerCase().includes(normalizedQuery) ||
    path.toLocaleLowerCase().includes(normalizedQuery),
  );

  return (
    <nav className="app-mobile-project-list" aria-label="Recent projects">
      <strong>Recent projects</strong>
      {uniquePaths.length > 4 && (
        <input type="search" aria-label="Find recent project" placeholder="Find project…"
          value={query} disabled={disabled} onChange={(event) => setQuery(event.target.value)} />
      )}
      {visiblePaths.length === 0 && <p role="status">No matching projects</p>}
      {visiblePaths.map((path) => {
        const index = uniquePaths.indexOf(path);
        const active = path === currentPath;
        return (
          <button
            key={path}
            type="button"
            title={path}
            aria-current={active ? "page" : undefined}
            disabled={active || disabled}
            onClick={() => onSelect(path)}
          >
            {labels[index]}{active ? " · Current" : ""}
          </button>
        );
      })}
    </nav>
  );
}
