/** Upload a Pokémon Essentials v21.1 project ZIP to Tauri's app-private storage.
 * Uses bounded chunks and the native ZIP path/size validation; no Android
 * broad-storage permission or content-URI filesystem assumptions required.
 */
import { invoke } from "@tauri-apps/api/core";

const CHUNK_SIZE = 256 * 1024;
const MAX_ZIP_BYTES = 512 * 1024 * 1024;

function encodeChunk(bytes: Uint8Array): string {
  // Avoid Function.apply/spread argument limits on mid-size archives.
  let binary = "";
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

export async function importProjectZip(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<string> {
  if (!file.name.toLowerCase().endsWith(".zip")) throw new Error("Choose a .zip project archive");
  if (file.size === 0) throw new Error("The project archive is empty");
  if (file.size > MAX_ZIP_BYTES) throw new Error("Project archive exceeds the 512 MiB limit");
  const id = await invoke<string>("begin_project_archive_import");
  try {
    let offset = 0;
    while (offset < file.size) {
      const buffer = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      const bytes = new Uint8Array(buffer);
      await invoke<number>("append_project_archive_chunk", {
        importId: id,
        chunkBase64: encodeChunk(bytes),
      });
      offset += bytes.length;
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

type ProjectArchiveExport = { export_id: string; size: number };

/** Export all project files without altering the app-private project.
 * Uses native file sharing when available; browser download otherwise.
 * Android WebView download support needs on-device verification.
 */
export async function exportProjectZip(
  projectPath: string,
  projectName: string,
  onProgress?: (percent: number) => void,
): Promise<void> {
  const exported = await invoke<ProjectArchiveExport>("begin_project_archive_export", {
    projectPath,
  });
  try {
    const chunks: BlobPart[] = [];
    for (let offset = 0; offset < exported.size; offset += CHUNK_SIZE) {
      const encoded = await invoke<string>("read_project_archive_export_chunk", {
        exportId: exported.export_id,
        offset,
      });
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      // Copy into a normal ArrayBuffer so DOM Blob types accept the chunk.
      const plain = new Uint8Array(bytes).buffer;
      chunks.push(plain);
      onProgress?.(Math.round(Math.min(95, ((offset + binary.length) / exported.size) * 95)));
    }
    const blob = new Blob(chunks, { type: "application/zip" });
    const safeName = projectName.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 70) || "EssentialsProject";
    const name = `${safeName}.zip`;
    const file = new File([blob], name, { type: "application/zip" });
    if (navigator.canShare?.({ files: [file] }) && navigator.share) {
      await navigator.share({ files: [file], title: name });
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
    onProgress?.(100);
  } finally {
    await invoke("discard_project_archive_export", { exportId: exported.export_id }).catch(() => {});
  }
}
