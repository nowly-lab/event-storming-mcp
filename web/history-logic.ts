import type { ChangeSummary } from "./types.ts";

export function frameClass(id: string, s: ChangeSummary): "added" | "removed" | "updated" | null {
  if (s.added.includes(id)) return "added";
  if (s.removed.includes(id)) return "removed";
  if (s.updated.includes(id)) return "updated";
  return null;
}
