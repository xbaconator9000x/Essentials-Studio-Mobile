/**
 * Save a stable PBS snapshot. Native writes are asynchronous; newer edits
 * must not be marked clean when an older revision finishes.
 */
export async function savePbsSnapshot<T>(
  snapshot: T,
  persist: (snapshot: T) => Promise<void>,
  afterWrite: () => void,
  markClean: () => void,
  isCurrent: () => boolean,
): Promise<void> {
  await persist(snapshot);
  // Even if the user edited again, the saved baseline must reflect what is
  // actually on disk so Cancel does not resurrect an older version.
  afterWrite();
  if (!isCurrent()) {
    throw new Error("PBS changed while saving; newer edits remain unsaved");
  }
  markClean();
}

/** Never pass React-owned mutable section/field arrays to an async writer. */
export function snapshotPbsSections<
  T extends { header: string; fields: Array<{ key: string; value: string }> }
>(sections: readonly T[]): T[] {
  return sections.map((section) => ({
    ...section,
    fields: section.fields.map((field) => ({ ...field })),
  }));
}
