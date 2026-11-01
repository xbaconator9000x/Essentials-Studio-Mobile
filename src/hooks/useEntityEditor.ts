/**
 * Generic entity editor hook.
 * Replaces usePbsFile.ts with a typed, entity-centric approach.
 * Modelled on useDatabase.ts — snapshot ref for cancel, useEditorRegistration for global save.
 */
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useEditorRegistration } from "../context/ProjectSaveContext";
import { savePbsSnapshot, snapshotPbsEntities } from "../services/pbsSaveGuards";

export interface UseEntityEditorResult<T> {
  items: T[];
  selectedId: string | null;
  selected: T | null;
  dirty: boolean;
  loading: boolean;
  error: string | null;
  select: (id: string) => void;
  update: (id: string, patch: Partial<T>) => void;
  add: (item: T) => void;
  remove: (id: string) => void;
  doSave: () => Promise<void>;
  doCancel: () => void;
}

/**
 * @param registrationId  e.g. "pbs-pokemon" — registered with ProjectSaveContext
 * @param getId           extract the entity's unique string key
 * @param load            async function that returns the full entity array
 * @param save            async function that persists the full entity array
 */
export function useEntityEditor<T>(
  registrationId: string,
  getId: (item: T) => string,
  load: () => Promise<T[]>,
  save: (items: T[]) => Promise<void>
): UseEntityEditorResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const snapshotRef = useRef<T[]>([]);
  const itemsRef = useRef<T[]>([]);
  const revisionRef = useRef(0);
  const savingRef = useRef<Promise<void> | null>(null);
  const loadRef = useRef(load);
  const saveRef = useRef(save);
  loadRef.current = load;
  saveRef.current = save;
  itemsRef.current = items;
  // True only after a successful load. Guards doSave so a failed load can never
  // persist an empty array over the real file.
  const loadedRef = useRef(false);

  // Load on mount
  useEffect(() => {
    let cancelled = false;
    revisionRef.current += 1;
    itemsRef.current = [];
    snapshotRef.current = [];
    setItems([]);
    setLoading(true);
    setError(null);
    setSelectedId(null);
    setDirty(false);
    loadedRef.current = false;

    load()
      .then((data) => {
        if (cancelled) return;
        revisionRef.current += 1;
        itemsRef.current = data;
        setItems(data);
        snapshotRef.current = snapshotPbsEntities(data);
        loadedRef.current = true;
        if (data.length > 0) setSelectedId(getId(data[0]));
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
    // The same panel can be reused for a different imported project.
    // Reload when its project-scoped loader changes.
  }, [registrationId, load, getId]);

  const selected = useMemo(
    () => selectedId !== null
      ? items.find((item) => getId(item) === selectedId) ?? null
      : null,
    [items, selectedId, getId]
  );

  const select = useCallback((id: string) => {
    setSelectedId(id);
  }, []);

  const update = useCallback((id: string, patch: Partial<T>) => {
    revisionRef.current += 1;
    // If the patch renames the entity's key, the selection (which tracks the old
    // id) would otherwise point at nothing and the detail panel would vanish.
    const current = itemsRef.current.find((item) => getId(item) === id);
    const newId = current ? getId({ ...current, ...patch }) : null;
    setItems((prev) =>
      prev.map((item) => getId(item) === id ? { ...item, ...patch } : item)
    );
    if (newId !== null && newId !== id) {
      setSelectedId((cur) => (cur === id ? newId : cur));
    }
    setDirty(true);
  }, [getId]);

  const add = useCallback((item: T) => {
    revisionRef.current += 1;
    setItems((prev) => [...prev, item]);
    setSelectedId(getId(item));
    setDirty(true);
  }, [getId]);

  const remove = useCallback((id: string) => {
    revisionRef.current += 1;
    setItems((prev) => {
      const filtered = prev.filter((item) => getId(item) !== id);
      return filtered;
    });
    setSelectedId((prev) => {
      if (prev !== id) return prev;
      const remaining = itemsRef.current.filter((item) => getId(item) !== id);
      return remaining.length > 0 ? getId(remaining[0]) : null;
    });
    setDirty(true);
  }, [getId]);

  const doSave = useCallback(async () => {
    if (!loadedRef.current) {
      const msg = "Cannot save: the data failed to load. Resolve the load error first to avoid overwriting the file with empty data.";
      setError(msg);
      throw new Error(msg);
    }
    if (savingRef.current) {
      throw new Error("PBS entity save already in progress");
    }

    // These panels are the actual PBS UI used by App.tsx. A shallow array
    // copy is insufficient: Pokémon entries contain nested forms/moves/stats.
    const payload = snapshotPbsEntities(itemsRef.current);
    const revision = revisionRef.current;
    const expectedLoad = loadRef.current;
    const expectedSave = saveRef.current;
    const isSameDocument = () =>
      loadRef.current === expectedLoad && saveRef.current === expectedSave;

    const operation = (async () => {
      setLoading(true);
      setError(null);
      try {
        await savePbsSnapshot(
          payload,
          (snapshot) => expectedSave(snapshot),
          () => {
            if (isSameDocument()) snapshotRef.current = payload;
          },
          () => setDirty(false),
          () => isSameDocument() && revisionRef.current === revision,
        );
      } catch (err) {
        if (isSameDocument()) setError(`Save failed: ${err}`);
        throw err; // Keep Save All/OK from closing after a failed native write.
      } finally {
        if (isSameDocument()) setLoading(false);
      }
    })();

    savingRef.current = operation;
    try {
      await operation;
    } finally {
      if (savingRef.current === operation) savingRef.current = null;
    }
  }, []);

  const doCancel = useCallback(() => {
    if (savingRef.current) {
      setError("Wait for the PBS save to finish before discarding changes");
      return;
    }
    revisionRef.current += 1;
    itemsRef.current = snapshotRef.current;
    setItems(snapshotRef.current);
    setDirty(false);
  }, []);

  useEditorRegistration(registrationId, doSave, doCancel, dirty);

  return {
    items, selectedId, selected, dirty, loading, error,
    select, update, add, remove, doSave, doCancel,
  };
}
