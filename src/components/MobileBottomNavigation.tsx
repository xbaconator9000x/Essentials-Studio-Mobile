import type { MobileWorkspaceSection } from "./MobileWorkspaceBar";

interface Props {
  section: MobileWorkspaceSection;
  hasMap: boolean;
  busy: boolean;
  onNavigate: (section: MobileWorkspaceSection) => void;
}

const SECTIONS: ReadonlyArray<{ id: MobileWorkspaceSection; label: string }> = [
  { id: "projects", label: "Projects" },
  { id: "maps", label: "Maps" },
  { id: "sprites", label: "Sprites" },
  { id: "settings", label: "Settings" },
];

/** Navigation changes only the visible workspace; save gates belong to actual
 * project/map transitions, never to moving between these mounted views. */
export function MobileBottomNavigation({ section, hasMap, busy, onNavigate }: Props) {
  return (
    <nav className="app-mobile-nav" aria-label="Main navigation" aria-busy={busy}>
      {SECTIONS.map(({ id, label }) => {
        const unavailable = id === "maps" && !hasMap;
        return (
          <button key={id} type="button" aria-current={section === id ? "page" : undefined}
            disabled={busy || unavailable}
            title={unavailable ? "Choose a map from Projects first" : undefined}
            onClick={() => onNavigate(id)}>
            {label}
          </button>
        );
      })}
    </nav>
  );
}
