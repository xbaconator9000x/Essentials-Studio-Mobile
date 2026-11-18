export function supportsDirectProjectFolderOpen(userAgent: string): boolean {
  return !/Android/i.test(userAgent);
}
