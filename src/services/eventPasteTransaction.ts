import { serializeProjectOperation } from "./projectMutationQueue.ts";

/**
 * A clipboard paste is two native writes (create_event then save_event).
 * Hold the same project queue used by map saves and ZIP snapshots across both
 * writes so an export cannot capture the placeholder event between them.
 *
 * On a failed save, remove the newly created placeholder. A failed rollback is
 * surfaced explicitly: callers must not report a successful paste/export.
 */
export async function pasteEventInProjectQueue<
  T extends { id: number; x: number; y: number },
  I,
>(
  projectPath: string,
  source: T,
  x: number,
  y: number,
  operations: {
    create: () => Promise<[T, I[]]>;
    save: (event: T) => Promise<void>;
    rollback: (id: number) => Promise<void>;
  },
): Promise<[T, I[]]> {
  if (!projectPath) throw new Error("Clipboard event paste requires an active project");

  return serializeProjectOperation(projectPath, async () => {
    const [created, infos] = await operations.create();
    const pasted = { ...source, id: created.id, x, y };
    try {
      await operations.save(pasted);
    } catch (saveError) {
      try {
        await operations.rollback(created.id);
      } catch (rollbackError) {
        throw new Error(
          "Event paste failed and rollback also failed; an incomplete event may remain on disk",
          { cause: new AggregateError([saveError, rollbackError]) },
        );
      }
      throw saveError;
    }
    return [pasted, infos];
  });
}
