import { save } from "@tauri-apps/plugin-dialog";
import { invoke } from "./tauriApi";
import { exportAndroidDocument } from "./androidDocumentExport";

export function spritePngFilename(name: string): string {
  const stem = name.replace(/\.png$/i, "").replace(/[^a-zA-Z0-9 _-]/g, "_").trim().slice(0, 100);
  return `${stem || "Sprite"}.png`;
}

/** Export the source canvas, never the zoomed viewport or trace overlay.
 * Android uses a staged, native-validated PNG and byte-verified SAF write.
 * Browser downloads are requests, not verified destination writes. */
export async function exportSpritePng(
  imageData: string, name: string,
): Promise<"saved" | "cancelled" | "requested"> {
  if (!imageData.startsWith("data:image/png;base64,")) throw new Error("Expected PNG image data");
  const filename = spritePngFilename(name);
  if (/Android/i.test(navigator.userAgent)) {
    const staged = await invoke<{ export_id: string; size: number }>("begin_sprite_png_export", { imageData });
    try {
      if (!Number.isSafeInteger(staged.size) || staged.size <= 0) throw new Error("Invalid staged PNG size");
      return await exportAndroidDocument(staged.export_id, staged.size, filename, {
        pickDestination: (defaultPath) => save({ defaultPath, filters: [{ name: "PNG images", extensions: ["png"] }] }),
        writeAndVerify: (exportId, documentUri) => invoke<number>("save_sprite_png_to_document", { exportId, documentUri }),
        discardDestination: (exportId, documentUri) => invoke<void>("discard_incomplete_project_archive_document", { exportId, documentUri }),
      }, undefined, 120_000, "PNG");
    } finally {
      await invoke("discard_sprite_png_export", { exportId: staged.export_id }).catch(() => {});
    }
  }
  const link = document.createElement("a");
  link.href = imageData;
  link.download = filename;
  document.body.appendChild(link);
  try { link.click(); } finally { link.remove(); }
  return "requested";
}
