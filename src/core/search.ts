import type { JsonNode, SearchMatch } from "./types";

export function searchNodes(nodes: JsonNode[], query: string): SearchMatch[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return [];

  const matches: SearchMatch[] = [];

  for (const node of nodes) {
    const key = node.key?.toLocaleLowerCase() ?? "";
    const value = (node.searchableText ?? node.valuePreview).toLocaleLowerCase();
    if (key.includes(normalized) || value.includes(normalized)) {
      matches.push({ nodeId: node.id });
    }
  }

  return matches;
}
