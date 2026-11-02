/**
 * Persist an immutable JSON event snapshot. A successful native write only
 * acknowledges the revision submitted, never later edits made in the UI.
 * XP event objects already use JSON snapshots in the undo stack.
 */
export async function saveEventSnapshot<T>(
  event: T,
  revision: number,
  currentRevision: () => number,
  write: (snapshot: T) => Promise<void>,
): Promise<boolean> {
  const snapshot = JSON.parse(JSON.stringify(event)) as T;
  await write(snapshot);
  return currentRevision() === revision;
}
