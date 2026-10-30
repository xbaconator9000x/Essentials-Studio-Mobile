/** Upload a Pokémon Essentials v21.1 project ZIP to Tauri's app-private storage.
 * Uses bounded chunks and the native ZIP path/size validation; no Android
 * broad-storage permission or content-URI filesystem assumptions required.
 */
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { exportAndroidDocument } from "./androidDocumentExport";
import {
  ARCHIVE_CHUNK_BYTES,
  decodeArchiveChunk,
  encodeArchiveChunk,
  expectedArchiveChunkLength,
  validateArchiveSize,
  verifyImportChunkAcknowledgement,
} from "./archiveChunks";

export async function importProjectZip(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a .zip project archive");
  validateArchiveSize(file.size);
  const id = await invoke<string>("begin_project_archive_import");
  try {
    let offset = 0;
    while (offset < file.size) {
      const expectedLength = expectedArchiveChunkLength(file.size, offset);
      const buffer = await file.slice(offset, offset + expectedLength).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      if (bytes.length !== expectedLength) {
        throw new Error("Project ZIP source became truncated during import");
      }
      const nextOffset = offset + expectedLength;
      const acknowledged = await invoke<number>("append_project_archive_chunk", {
        importId: id,
        expectedOffset: offset,
        chunkBase64: encodeArchiveChunk(bytes),
      });
      verifyImportChunkAcknowledgement(acknowledged, nextOffset);
      offset = nextOffset;
      onProgress?.(Math.round((offset / file.size) * 95));
    }
    const path = await invoke<string>("finish_project_archive_import", { importId: id });
    onProgress?.(100);
    return path;
  } catch (error) {
    await invoke("abort_project_archive_import", { importId: id }).catch(() => {});
    throw error;
  }
}

/** Discard only a rejected, newly imported app-private project directory.
 * Never invoke this for a project that has become the active editor project.
 */
export async function discardFailedProjectImport(projectPath: string): Promise<void> {
  await invoke("discard_failed_project_import", { projectPath });
}

type ProjectArchiveExport = { export_id: string; size: number };

/** Export all project files without altering the app-private project.
 * Uses native file sharing when available; browser download otherwise.
 * Android WebView download support needs on-device verification.
 */
export async function exportProjectZip(
  projectPath: string,
  projectName: string,
  onProgress?: (percent: number) => void,
): Promise<"saved" | "cancelled" | "requested"> {
  const exported = await invoke<ProjectArchiveExport>("begin_project_archive_export", {
    projectPath,
  });
  try {
    validateArchiveSize(exported.size);
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70) || "EssentialsProject";
    const name = `${safeName}.zip`;

    // Android's native picker returns a scoped content:// URI, not a file
    // path. Rust streams the app-private ZIP via ContentResolver and reopens
    // the document to verify every byte. Avoid the WebView Blob/share fallback
    // (and its 512 MiB JS memory cost) on Android.
    if (/Android/i.test(navigator.userAgent)) {
      // Preserve the native provider result so the UI never confuses a
      // cancelled picker with a byte-verified document save.
      return await exportAndroidDocument(exported.export_id, exported.size, name, {
        pickDestination: (filename) => save({
          defaultPath: filename,
          filters: [{ name: "ZIP archives", extensions: ["zip"] }],
        }),
        writeAndVerify: (exportId, documentUri) =>
          invoke<number>("save_project_archive_to_document", { exportId, documentUri }),
      }, onProgress);
    }

    const chunks: BlobPart[] = [];
    for (let offset = 0; offset < exported.size; offset += ARCHIVE_CHUNK_BYTES) {
      const expectedLength = expectedArchiveChunkLength(exported.size, offset);
      const encoded = await invoke<string>("read_project_archive_export_chunk", {
        exportId: exported.export_id,
        offset,
      });
      const bytes = decodeArchiveChunk(encoded, expectedLength);
      // Copy into a normal ArrayBuffer so DOM Blob types accept the chunk.
      chunks.push(new Uint8Array(bytes).buffer);
      onProgress?.(Math.round(Math.min(95, ((offset + expectedLength) / exported.size) * 95)));
    }
    const blob = new Blob(chunks, { type: "application/zip" });
    if (blob.size !== exported.size) {
      throw new Error("Project ZIP export was truncated before sharing");
    }
    const file = new File([blob], name, { type: "application/zip" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      try {
        await navigator.share({ files: [file], title: name });
      } catch (error) {
        // Closing the native share sheet is a cancellation, not an export
        // failure and certainly not a verified document save.
        if (error instanceof DOMException && error.name === "AbortError") {
          return "cancelled";
        }
        throw error;
      }
    } else {
      const url = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = url;
        link.download = name;
        document.body.appendChild(link);
        link.click();
        link.remove();
      } finally {
        // Allow browsers that enqueue the download after a click to resolve it.
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
    }
    // A browser share/download request is not a verified destination write.
    onProgress?.(100);
    return "requested";
  } finally {
    await invoke("discard_project_archive_export", { exportId: exported.export_id }).catch(() => {});
  }
}
