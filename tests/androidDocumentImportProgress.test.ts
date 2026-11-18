import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const channels: Array<{ onmessage: ((message: unknown) => void) | null }> = [];
  class TestChannel {
    onmessage: ((message: unknown) => void) | null = null;
    constructor() {
      channels.push(this);
    }
  }
  return {
    channels,
    Channel: TestChannel,
    invoke: vi.fn(),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ Channel: mocks.Channel }));
vi.mock("../src/services/tauriApi", () => ({ invoke: mocks.invoke }));

import {
  importProjectZipFromAndroidDocument,
  type AndroidDocumentImportProgress,
} from "../src/services/archiveApi";

describe("Android document import progress", () => {
  beforeEach(() => {
    mocks.channels.length = 0;
    mocks.invoke.mockReset();
  });

  it("reports native byte-read and validation stages instead of only start and completion", async () => {
    const progress: AndroidDocumentImportProgress[] = [];
    const percent: number[] = [];
    mocks.invoke.mockImplementation(async (_command: string, args: Record<string, unknown>) => {
      const channel = args.progress as { onmessage: ((message: unknown) => void) | null };
      channel.onmessage?.({ stage: "reading", bytesRead: 65_536 });
      channel.onmessage?.({ stage: "validating", bytesRead: 65_536 });
      channel.onmessage?.({ stage: "ready", bytesRead: 65_536 });
      return "/private/imported-project";
    });

    const projectPath = await importProjectZipFromAndroidDocument(
      "content://provider/document/project.zip",
      (value) => percent.push(value),
      (value) => progress.push(value),
    );

    expect(projectPath).toBe("/private/imported-project");
    expect(percent).toEqual([0, 100]);
    expect(progress).toEqual([
      { stage: "reading", bytesRead: 65_536 },
      { stage: "validating", bytesRead: 65_536 },
      { stage: "ready", bytesRead: 65_536 },
    ]);
    expect(mocks.invoke).toHaveBeenCalledWith(
      "import_project_archive_from_document",
      expect.objectContaining({
        documentUri: "content://provider/document/project.zip",
        progress: mocks.channels[0],
      }),
    );
    expect(mocks.channels[0].onmessage).toBeTypeOf("function");
  });
});
