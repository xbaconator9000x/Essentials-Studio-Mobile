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
