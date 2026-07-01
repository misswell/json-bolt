import type { JsonNode, JsonNodeType, ParseResult } from "./types";

const MAX_PREVIEW_LENGTH = 160;

export function jsonTypeOf(value: unknown): JsonNodeType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  switch (typeof value) {
    case "string":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    default:
      return "object";
  }
}

export function createPreview(value: unknown, type = jsonTypeOf(value)): string {
  if (type === "object") return "{...}";
  if (type === "array") return "[...]";
  if (type === "string") {
    const text = JSON.stringify(value);
    return text.length > MAX_PREVIEW_LENGTH
      ? `${text.slice(0, MAX_PREVIEW_LENGTH)}...`
      : text;
  }
  return String(value);
}

export function flattenJson(value: unknown): ParseResult {
  const nodes: JsonNode[] = [];

  function addNode(
    currentValue: unknown,
    key: string | null,
    parentId: number | null,
    depth: number
  ): number {
    const id = nodes.length;
    const type = jsonTypeOf(currentValue);
    const node: JsonNode = {
      id,
      parentId,
      key,
      type,
      depth,
      valuePreview: createPreview(currentValue, type),
      searchableText: createSearchableText(currentValue, type),
      childCount: 0
    };

    nodes.push(node);

    if (type === "array") {
      const children = (currentValue as unknown[]).map((item, index) =>
        addNode(item, String(index), id, depth + 1)
      );
      node.children = children;
      node.childCount = children.length;
    } else if (type === "object") {
      const entries = Object.entries(currentValue as Record<string, unknown>);
      const children = entries.map(([childKey, childValue]) =>
        addNode(childValue, childKey, id, depth + 1)
      );
      node.children = children;
      node.childCount = children.length;
    }

    return id;
  }

  const rootId = addNode(value, null, null, 0);
  return { nodes, rootIds: [rootId] };
}

function createSearchableText(value: unknown, type = jsonTypeOf(value)): string {
  if (type === "object") return "{}";
  if (type === "array") return "[]";
  if (type === "string") return String(value);
  return String(value);
}

export function buildVisibleNodes(
  rootIds: number[],
  nodesById: Map<number, JsonNode>,
  expandedIds: Set<number>
): JsonNode[] {
  const result: JsonNode[] = [];
  const stack = [...rootIds].reverse();

  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;

    const node = nodesById.get(id);
    if (!node) continue;

    result.push(node);

    if (expandedIds.has(id) && node.children) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]);
      }
    }
  }

  return result;
}

export function collectExpandableIds(nodes: JsonNode[]): number[] {
  return nodes
    .filter((node) => node.childCount > 0 && node.children && node.children.length > 0)
    .map((node) => node.id);
}

export function createInitialExpandedIds(nodes: JsonNode[], rootIds: number[]): Set<number> {
  const expanded = new Set(rootIds);

  for (const node of nodes) {
    if (node.depth < 2 && node.childCount > 0 && node.childCount <= 200) {
      expanded.add(node.id);
    }
  }

  return expanded;
}
