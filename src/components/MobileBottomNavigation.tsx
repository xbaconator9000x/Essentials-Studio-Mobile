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

/** Small vector glyphs maintain consistent visual weight on Android WebView. */
function SectionIcon({ section }: { section: MobileWorkspaceSection }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {section === "projects" && (
        <>
          <path d="M3 7h7l2 2h9v11H3z" />
          <path d="M3 7V4h6l2 3" />
        </>
      )}
      {section === "maps" && (
        <>
          <path d="M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z" />
          <path d="M9 3v16M15 5v16" />
        </>
      )}
      {section === "sprites" && (
        <>
          <path d="M14 5l5 5M11 8l5 5M14 5l3-3 5 5-3 3-8 8-5 1 1-5z" />
          <path d="M3 18c2-1 3-1 4 0 1 1 1 3-3 3H2" />
        </>
      )}
      {section === "settings" && (
        <>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.9 4.9L7 7m10 10 2.1 2.1m0-14.2L17 7M7 17l-2.1 2.1" />
        </>
      )}
    </svg>
  );
}

/** Navigation switches mounted workspaces; Sprites opens the actual editor
 * directly via the existing onNavigate handler, without a second landing tap. */
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
            <SectionIcon section={id} />
            <span>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
