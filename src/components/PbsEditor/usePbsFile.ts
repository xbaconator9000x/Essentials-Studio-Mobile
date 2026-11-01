/**
 * Hook for loading / editing / saving a single PBS file.
 * Analogous to useDatabase.ts for .rxdata files.
 */
import { useState, useEffect, useCallback, useRef } from "react";
import type { PbsSection } from "../../types/pbsTypes";
import { loadPbsFile, savePbsFile } from "../../services/tauriApi";
import { useEditorRegistration } from "../../context/ProjectSaveContext";
import { savePbsSnapshot, snapshotPbsSections } from "../../services/pbsSaveGuards";

export interface UsePbsFileResult {
  sections: PbsSection[];
  selectedHeader: string | null;
  selected: PbsSection | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  select: (header: string) => void;
  updateField: (key: string, value: string) => void;
  addField: (key: string) => void;
  deleteField: (key: string) => void;
  addSection: (header: string) => void;
  deleteSection: (header: string) => void;
  save: () => Promise<void>;
  cancel: () => void;
}

export function usePbsFile(
  projectPath: string,
  filename: string
): UsePbsFileResult {
  const [sections, setSections] = useState<PbsSection[]>([]);
  const [selectedHeader, setSelectedHeader] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshotRef = useRef<PbsSection[]>([]);
  const sectionsRef = useRef<PbsSection[]>([]);
  const revisionRef = useRef(0);
  const identityRef = useRef("");
  const savingRef = useRef<Promise<void> | null>(null);
  identityRef.current = `${projectPath}\0${filename}`;
  sectionsRef.current = sections;

  // Load on mount / filename change
  useEffect(() => {
    let cancelled = false;
    // A stale save from the previous project/file must not clean this one.
    revisionRef.current += 1;
    snapshotRef.current = [];
    sectionsRef.current = [];
    setSections([]);
    setLoading(true);
    setError(null);
    setSelectedHeader(null);
    setDirty(false);

    loadPbsFile(projectPath, filename)
      .then((data) => {
        if (cancelled) return;
        revisionRef.current += 1;
        sectionsRef.current = data;
        setSections(data);
        snapshotRef.current = snapshotPbsSections(data);
        if (data.length > 0) setSelectedHeader(data[0].header);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [projectPath, filename]);

  const selected = selectedHeader !== null
    ? sections.find((s) => s.header === selectedHeader) ?? null
    : null;

  const select = useCallback((header: string) => {
    setSelectedHeader(header);
  }, []);

  const updateField = useCallback((key: string, value: string) => {
    revisionRef.current += 1;
    setSections((prev) => {
      if (selectedHeader === null) return prev;
      return prev.map((s) => {
        if (s.header !== selectedHeader) return s;
        const fieldIdx = s.fields.findIndex((f) => f.key === key);
        if (fieldIdx === -1) return s;
        const newFields = [...s.fields];
        newFields[fieldIdx] = { key, value };
        return { ...s, fields: newFields };
      });
    });
    setDirty(true);
  }, [selectedHeader]);

  const addField = useCallback((key: string) => {
    revisionRef.current += 1;
    setSections((prev) => {
      if (selectedHeader === null) return prev;
      return prev.map((s) => {
        if (s.header !== selectedHeader) return s;
        if (s.fields.some((f) => f.key === key)) return s; // no duplicates
        return { ...s, fields: [...s.fields, { key, value: "" }] };
      });
    });
    setDirty(true);
  }, [selectedHeader]);

  const deleteField = useCallback((key: string) => {
    revisionRef.current += 1;
    setSections((prev) => {
      if (selectedHeader === null) return prev;
      return prev.map((s) => {
        if (s.header !== selectedHeader) return s;
        return { ...s, fields: s.fields.filter((f) => f.key !== key) };
      });
    });
    setDirty(true);
  }, [selectedHeader]);

  const addSection = useCallback((header: string) => {
    revisionRef.current += 1;
    setSections((prev) => {
      if (prev.some((s) => s.header === header)) return prev; // no duplicates
      const newSection: PbsSection = { header, fields: [{ key: "Name", value: header }] };
      return [...prev, newSection];
    });
    setSelectedHeader(header);
    setDirty(true);
  }, []);

  const deleteSection = useCallback((header: string) => {
    revisionRef.current += 1;
    setSections((prev) => {
      const filtered = prev.filter((s) => s.header !== header);
      return filtered;
    });
    setSelectedHeader((prev) => {
      if (prev !== header) return prev;
      const remaining = sectionsRef.current.filter((s) => s.header !== header);
      return remaining.length > 0 ? remaining[0].header : null;
    });
    setDirty(true);
  }, []);

  const save = useCallback(async () => {
    if (savingRef.current) {
      throw new Error("PBS save already in progress");
    }
    const identity = identityRef.current;
    const revision = revisionRef.current;
    const payload = snapshotPbsSections(sectionsRef.current);
    const operation = (async () => {
      setLoading(true);
      setError(null);
      try {
        await savePbsSnapshot(
          payload,
          (snapshot) => savePbsFile(projectPath, filename, snapshot),
          () => {
            if (identityRef.current === identity) snapshotRef.current = payload;
          },
          () => setDirty(false),
          () => identityRef.current === identity && revisionRef.current === revision,
        );
      } catch (err) {
        if (identityRef.current === identity) setError(`Save failed: ${err}`);
        // ProjectSaveContext.saveAll must see the rejection; otherwise OK
        // closes the editor and the SAF export can omit the user's changes.
        throw err;
      } finally {
        if (identityRef.current === identity) setLoading(false);
      }
    })();
    savingRef.current = operation;
    try {
      await operation;
    } finally {
      if (savingRef.current === operation) savingRef.current = null;
    }
  }, [projectPath, filename]);

  const cancel = useCallback(() => {
    // Discarding while the native writer is active would display an older
    // baseline as clean even though the writer may still replace disk bytes.
    if (savingRef.current) {
      setError("Wait for the PBS save to finish before discarding changes");
      return;
    }
    revisionRef.current += 1;
    sectionsRef.current = snapshotRef.current;
    setSections(snapshotRef.current);
    setDirty(false);
  }, []);

  // Register with global save context so Ctrl+S and PBS Apply work
  useEditorRegistration(`pbs-${filename}`, save, cancel, dirty);

  return {
    sections, selectedHeader, selected, dirty, loading, error,
    select, updateField, addField, deleteField, addSection, deleteSection,
    save, cancel,
  };
}
