import type { RpgEvent } from "../types";

type ProjectInvoke = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export function createEventProjectBridge(invoke: ProjectInvoke) {
  return {
    loadEvent: async (projectPath: string, mapId: number, eventId: number): Promise<RpgEvent> =>
      (await invoke("load_event", { projectPath, mapId, eventId })) as RpgEvent,
    saveEvent: async (projectPath: string, mapId: number, event: RpgEvent): Promise<void> => {
      await invoke("save_event", { projectPath, mapId, event });
    },
  };
}
