import type { PbsSection, PbsField } from "../types/pbsTypes";

/**
 * Entity editors only model part of the Essentials PBS vocabulary. Rebuild
 * their structured save payload around the original ordered fields so native
 * lossless merging retains custom keys, comments, whitespace and CRLF.
 * Unsupported structural deletions must fail rather than silently lose data.
 */
export function preserveOpaquePbsFields(
  original: readonly PbsSection[],
  edited: readonly PbsSection[],
  managedKeys: ReadonlySet<string>,
): PbsSection[] {
  if (edited.length < original.length) {
    throw new Error("PBS section deletion is unsupported by the structured editor; use raw PBS editing");
  }
  return edited.map((section, index) => {
    const old = original[index];
    if (!old) {
      return { header: section.header, fields: section.fields.map((field) => ({ ...field })) };
    }
    if (old.header !== section.header) {
      throw new Error(`PBS section order/identity changed at ${index}: ${old.header} → ${section.header}; use raw PBS editing`);
    }
    const newByKey = new Map<string, PbsField[]>();
    for (const field of section.fields) {
      const queue = newByKey.get(field.key) ?? [];
      queue.push(field);
      newByKey.set(field.key, queue);
    }
    const consumed = new Map<string, number>();
    const fields = old.fields.map((field) => {
      if (!managedKeys.has(field.key)) return { ...field };
      const offset = consumed.get(field.key) ?? 0;
      const replacement = newByKey.get(field.key)?.[offset];
      if (!replacement) {
        throw new Error(`PBS ${old.header}.${field.key} would be removed; use raw PBS editing`);
      }
      consumed.set(field.key, offset + 1);
      return { key: field.key, value: replacement.value };
    });
    // New fields are appended. The native merger verifies the original field
    // prefix and retains unparsed source lines verbatim.
    const appended = new Map<string, number>();
    for (const field of section.fields) {
      const offset = appended.get(field.key) ?? 0;
      appended.set(field.key, offset + 1);
      if (offset >= (consumed.get(field.key) ?? 0)) fields.push({ ...field });
    }
    return { header: old.header, fields };
  });
}
