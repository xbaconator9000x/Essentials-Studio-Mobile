export function EditableCondition({
  active,
  onToggle,
  label,
  children,
}: {
  active: boolean;
  onToggle: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="condition-item">
      <label className="event-condition-toggle">
        <input type="checkbox" checked={active} onChange={onToggle} />
        <span>{label}</span>
      </label>
      {active && <div className="event-condition-fields">{children}</div>}
    </div>
  );
}

export function ToggleBadge({ on, onToggle, label }: { on: boolean; onToggle: () => void; label?: string }) {
  return (
    <button type="button" aria-label={label} aria-pressed={on}
      className={`prop-badge ${on ? "prop-badge-on" : "prop-badge-off"}`}
      onClick={onToggle}>
      {on ? "ON" : "OFF"}
    </button>
  );
}

/** Dropdown selector that shows [0001] Name entries for switches/variables */
export function NamedIdSelector({
  value,
  onChange,
  names,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  names: string[];
  label: string;
}) {
  // If names available (length > 1, since index 0 is always empty), show dropdown
  if (names.length > 1) {
    return (
      <select
        className="prop-select"
        aria-label={label}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ flex: 1, minWidth: 100, maxWidth: 200, fontSize: 10 }}
      >
        {(value < 1 || value >= names.length) && <option value={value}>[{value}] (unlisted)</option>}
        {names.map((name, i) => {
          if (i === 0) return null; // skip index 0
          return (
            <option key={i} value={i}>
              [{String(i).padStart(4, "0")}] {name || `${label} ${i}`}
            </option>
          );
        })}
      </select>
    );
  }
  // Fallback to number input
  return (
    <input
      type="number"
      className="prop-number-input"
      aria-label={label}
      value={value}
      min={1}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export function NumberInput({
  value,
  onChange,
  min,
  max,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  label?: string;
}) {
  return (
    <input
      type="number"
      className="prop-number-input"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
