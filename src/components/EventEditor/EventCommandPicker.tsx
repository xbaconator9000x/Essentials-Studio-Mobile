import { useState } from "react";
import {
  getPickerCommandsByCategory,
  COMMAND_CATEGORIES,
  type CommandDef,
} from "../../services/eventCommands";

interface Props {
  onSelect: (command: CommandDef) => void;
  onClose: () => void;
}

/**
 * Dialog for selecting a new event command to insert.
 * Shows commands grouped by category with search filtering.
 */
export function EventCommandPicker({ onSelect, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const commandsByCategory = getPickerCommandsByCategory();
  const searchLower = search.toLowerCase();
  const visibleCommandCount = [...commandsByCategory.entries()].reduce(
    (count, [category, commands]) => {
      if (selectedCategory && selectedCategory !== category) return count;
      return count + commands.filter(
        (command) =>
          command.name.toLowerCase().includes(searchLower) ||
          command.description.toLowerCase().includes(searchLower),
      ).length;
    },
    0,
  );

  return (
    <div className="command-picker-overlay" onClick={(e) => {
      if ((e.target as HTMLElement).classList.contains("command-picker-overlay")) {
        onClose();
      }
    }}>
      <div
        className="command-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-picker-title"
      >
        <div className="command-picker-header">
          <h3 id="command-picker-title">Insert Command</h3>
          <button
            type="button"
            className="event-editor-close"
            aria-label="Close command picker"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {/* Search */}
        <div className="command-picker-search">
          <input
            type="text"
            aria-label="Search event commands"
            placeholder="Search commands..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            autoFocus
          />
        </div>

        <div className="command-picker-body">
          {/* Category tabs */}
          <div className="command-picker-categories">
            <button
              type="button"
              className={`command-picker-cat ${selectedCategory === null ? "active" : ""}`}
              aria-pressed={selectedCategory === null}
              onClick={() => setSelectedCategory(null)}
            >
              All
            </button>
            {COMMAND_CATEGORIES.map((cat) => (
              <button
                key={cat}
                type="button"
                className={`command-picker-cat ${selectedCategory === cat ? "active" : ""}`}
                aria-pressed={selectedCategory === cat}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Command list */}
          <div className="command-picker-list" aria-label="Available event commands">
            {visibleCommandCount === 0 && (
              <div className="command-picker-empty" role="status">
                No commands match this search.
              </div>
            )}
            {COMMAND_CATEGORIES.map((cat) => {
              if (selectedCategory && selectedCategory !== cat) return null;
              const commands = commandsByCategory.get(cat) ?? [];
              const filtered = search
                ? commands.filter(
                    (c) =>
                      c.name.toLowerCase().includes(searchLower) ||
                      c.description.toLowerCase().includes(searchLower)
                  )
                : commands;

              if (filtered.length === 0) return null;

              return (
                <div key={cat}>
                  {!selectedCategory && (
                    <div className="command-picker-cat-header">{cat}</div>
                  )}
                  {filtered.map((cmd, index) => (
                    <button
                      key={`${cat}-${cmd.code}-${index}`}
                      type="button"
                      className="command-picker-item"
                      onClick={() => onSelect(cmd)}
                    >
                      <span className="command-picker-item-code">
                        {cmd.code}
                      </span>
                      <span className="command-picker-item-name">
                        {cmd.name}
                      </span>
                      <span className="command-picker-item-desc">
                        {cmd.description}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
