import { useEffect, useState } from "react";
import "./MobileOperationFeedback.css";

interface Props {
  progress?: string | null;
  outcome?: string | null;
  error?: string | null;
  onDismissOutcome: () => void;
  onDismissError: () => void;
}

/**
 * The native Save All, import/export and error messages remain untouched.
 * Only their mobile presentation changes: one short summary by default,
 * with an explicit way to inspect the complete receipt or diagnostic.
 */
export function MobileOperationFeedback({
  progress, outcome, error, onDismissOutcome, onDismissError,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  // A new receipt is not the same as a previously expanded receipt. Native
  // operation progress also returns the UI to the compact presentation.
  useEffect(() => setExpanded(false), [outcome, progress]);

  if (!progress && !outcome && !error) return null;

  return (
    <div className="app-mobile-operation-feedback" aria-label="Project operation updates">
      {progress && (
        <div className="app-mobile-operation-line is-progress" role="status" aria-live="polite">
          <span className="app-mobile-operation-text">{progress}</span>
        </div>
      )}
      {!progress && error && (
        <div className="app-mobile-operation-line is-error" role="alert">
          <span className="app-mobile-operation-text">{error}</span>
          <button type="button" aria-label={expanded ? "Collapse operation details" : "Show full operation details"}
            onClick={() => setExpanded(open => !open)}>{expanded ? "Less" : "Details"}</button>
          <button type="button" aria-label="Dismiss operation error"
            onClick={onDismissError}>×</button>
        </div>
      )}
      {!progress && !error && outcome && (
        <div className="app-mobile-operation-line is-outcome" role="status" aria-live="polite">
          <span className="app-mobile-operation-text">{outcome}</span>
          <button type="button" aria-label={expanded ? "Collapse operation details" : "Show full operation details"}
            onClick={() => setExpanded(open => !open)}>{expanded ? "Less" : "Details"}</button>
          <button type="button" aria-label="Dismiss operation message"
            onClick={onDismissOutcome}>×</button>
        </div>
      )}
      <style>{`.app-mobile-operation-feedback ${expanded ? ".app-mobile-operation-text" : ".__never"} { white-space: normal; overflow: visible; text-overflow: clip; }`}</style>
    </div>
  );
}
