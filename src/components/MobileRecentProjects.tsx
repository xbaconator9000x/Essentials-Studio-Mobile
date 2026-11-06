import "./MobileRecentProjects.css";

interface Props {
  paths: string[];
  currentPath: string;
  disabled: boolean;
  onSelect: (path: string) => void;
}

function projectLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) || "Project";
}

export function MobileRecentProjects({ paths, currentPath, disabled, onSelect }: Props) {
  if (paths.length < 2) return null;
  const labelCounts = new Map<string, number>();
  for (const path of paths) {
    const label = projectLabel(path);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }

  return (
    <nav className="app-mobile-project-list" aria-label="Recent projects">
      <strong>Recent projects</strong>
      {paths.map((path) => {
        const segments = path.split(/[\\/]/).filter(Boolean);
        const name = projectLabel(path);
        const label = labelCounts.get(name) === 1 ? name : `${segments.at(-2) ?? "…"}/${name}`;
        const active = path === currentPath;
        return (
          <button
            key={path}
            type="button"
            aria-current={active ? "page" : undefined}
            disabled={active || disabled}
            onClick={() => onSelect(path)}
          >
            {label}{active ? " · Current" : ""}
          </button>
        );
      })}
    </nav>
  );
}
