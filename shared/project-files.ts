/** Agent-only project files — never shown in the editor UI or uploaded to public hosting. */
export const CRAFT_MD_FILENAME = "craft.md";

export function isInternalAgentFile(filename: string): boolean {
  return filename.trim().toLowerCase() === CRAFT_MD_FILENAME;
}

/** Extra pages the user can open as editor tabs (HTML only; craft.md excluded). */
export function isEditorVisibleProjectFile(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  if (lower === "index.html") return false;
  if (isInternalAgentFile(lower)) return false;
  return lower.endsWith(".html");
}

/** Extra pages that may be published to the public site bucket. */
export function isPublishableProjectFile(filename: string): boolean {
  const lower = filename.trim().toLowerCase();
  if (lower === "index.html") return false;
  if (isInternalAgentFile(lower)) return false;
  return lower.endsWith(".html");
}
