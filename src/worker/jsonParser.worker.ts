import type { JsonNode, JsonNodeType, ParserRequest, ParserResponse } from "../core/types";

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;
const PREVIEW_LIMIT = 160;
const STREAM_PARSE_THRESHOLD_BYTES = 450 * 1024 * 1024;

let sourceText = "";
let currentBlob: Blob | null = null;
let nextNodeId = 0;
let indexedNodes: JsonNode[] = [];

ctx.onmessage = async (event: MessageEvent<ParserRequest>) => {
  const message = event.data;

  if (message.type === "parse") {
    await handleParse(message);
    return;
  }

  if (message.type === "expand") {
    handleExpand(message);
    return;
  }

  if (message.type === "search") {
    void handleSearch(message);
  }
};

async function handleParse(message: Extract<ParserRequest, { type: "parse" }>): Promise<void> {
  const { requestId } = message;
  postResponse({ type: "progress", requestId, stage: "reading", parsed: 0, total: 1 });

  try {
    if (message.blob && message.blob.size > STREAM_PARSE_THRESHOLD_BYTES) {
      await handleStreamParse(message.blob, requestId);
      return;
    }

    currentBlob = message.blob ?? null;
    sourceText = message.blob ? await message.blob.text() : message.text ?? "";
    nextNodeId = 0;
    indexedNodes = [];

    const total = sourceText.length || 1;
    postResponse({ type: "progress", requestId, stage: "parsing", parsed: 0, total });

    const rootStart = skipWhitespace(0);
    const root = readNode(rootStart, null, null, 0);
    const rootEnd = skipWhitespace(root.valueEnd ?? rootStart);
    if (rootEnd < sourceText.length) {
      throw new JsonScanError("Unexpected trailing content after JSON value", rootEnd);
    }

    postResponse({ type: "progress", requestId, stage: "building", parsed: Math.floor(total * 0.85), total });

    if (root.childCount > 0 && root.valueStart !== undefined) {
      const expanded = readChildren(root);
      root.children = expanded.childIds;
      indexedNodes = [root, ...expanded.children];
      postResponse({
        type: "success",
        requestId,
        nodes: indexedNodes,
        rootIds: [root.id]
      });
    } else {
      indexedNodes = [root];
      postResponse({ type: "success", requestId, nodes: [root], rootIds: [root.id] });
    }

  } catch (error) {
    const position = error instanceof JsonScanError ? error.position : undefined;
    const location = position === undefined ? undefined : getLineColumn(sourceText, position);
    postResponse({
      type: "error",
      requestId,
      message: getErrorMessage(error),
      position,
      line: location?.line,
      column: location?.column
    });
  }
}

function handleExpand(message: Extract<ParserRequest, { type: "expand" }>): void {
  if (sourceText.length === 0 && currentBlob) {
    void handleStreamExpand(message);
    return;
  }

  try {
    const shell = readNode(message.valueStart, null, null, message.depth);
    shell.id = message.nodeId;
    const expanded = readChildren(shell);
    mergeIndexedNodes([{ ...shell, children: expanded.childIds }, ...expanded.children]);
    postResponse({
      type: "expanded",
      requestId: message.requestId,
      nodeId: message.nodeId,
      children: expanded.children,
      childIds: expanded.childIds
    });
  } catch (error) {
    const position = error instanceof JsonScanError ? error.position : undefined;
    const location = position === undefined ? undefined : getLineColumn(sourceText, position);
    postResponse({
      type: "error",
      requestId: message.requestId,
      message: getErrorMessage(error),
      position,
      line: location?.line,
      column: location?.column
    });
  }
}

async function handleStreamParse(blob: Blob, requestId: number): Promise<void> {
  sourceText = "";
  currentBlob = blob;
  nextNodeId = 0;
  indexedNodes = [];

  try {
    const scanner = new BlobScanner(blob, requestId);
    const rootStart = await scanner.skipWhitespace();
    const rootInfo = await scanner.skipValue(rootStart);
    const rootEnd = await scanner.skipWhitespace(rootInfo.end);
    if (rootEnd < blob.size) {
      throw new JsonScanError("Unexpected trailing content after JSON value", rootEnd);
    }

    postResponse({
      type: "progress",
      requestId,
      stage: "building",
      parsed: Math.floor(blob.size * 0.85),
      total: blob.size
    });

    const root = await createStreamNode(rootInfo, null, null, 0, blob);
    if (root.childCount > 0) {
      const expanded = await readStreamChildren(root, requestId);
      root.children = expanded.childIds;
      indexedNodes = [root, ...expanded.children];
      postResponse({ type: "success", requestId, nodes: indexedNodes, rootIds: [root.id] });
      return;
    }

    indexedNodes = [root];
    postResponse({ type: "success", requestId, nodes: [root], rootIds: [root.id] });
  } catch (error) {
    postStreamError(error, requestId);
  }
}

async function handleStreamExpand(message: Extract<ParserRequest, { type: "expand" }>): Promise<void> {
  if (!currentBlob) return;

  try {
    const scanner = new BlobScanner(currentBlob.slice(message.valueStart), message.requestId, message.valueStart);
    const info = await scanner.skipValue(message.valueStart);
    const shell = await createStreamNode(info, null, null, message.depth, currentBlob);
    shell.id = message.nodeId;
    const expanded = await readStreamChildren(shell, message.requestId);
    mergeIndexedNodes([{ ...shell, children: expanded.childIds }, ...expanded.children]);
    postResponse({
      type: "expanded",
      requestId: message.requestId,
      nodeId: message.nodeId,
      children: expanded.children,
      childIds: expanded.childIds
    });
  } catch (error) {
    postStreamError(error, message.requestId);
  }
}

async function handleSearch(message: Extract<ParserRequest, { type: "search" }>): Promise<void> {
  const query = message.query.trim();
  if (!query) {
    postResponse({ type: "search", requestId: message.requestId, query: message.query, matches: [] });
    return;
  }

  if (sourceText) {
    postResponse({
      type: "search",
      requestId: message.requestId,
      query: message.query,
      matches: searchInText(sourceText, query, message.limit)
    });
    return;
  }

  if (currentBlob) {
    postResponse({
      type: "search",
      requestId: message.requestId,
      query: message.query,
      matches: await searchInBlob(currentBlob, query, message.limit)
    });
    return;
  }

  postResponse({ type: "search", requestId: message.requestId, query: message.query, matches: [] });
}

function readNode(start: number, key: string | null, parentId: number | null, depth: number): JsonNode {
  const valueStart = skipWhitespace(start);
  const type = readType(valueStart);
  const valueEnd = skipValue(valueStart);
  const childCount = type === "object" || type === "array" ? countChildren(valueStart, type) : 0;

  return {
    id: nextNodeId++,
    parentId,
    key,
    type,
    depth,
    valuePreview: createPreview(valueStart, valueEnd, type),
    searchableText: createSearchableText(valueStart, valueEnd, type),
    valueStart,
    valueEnd,
    childCount
  };
}

function readChildren(parent: JsonNode): { children: JsonNode[]; childIds: number[] } {
  if (parent.valueStart === undefined || (parent.type !== "object" && parent.type !== "array")) {
    return { children: [], childIds: [] };
  }

  return parent.type === "object" ? readObjectChildren(parent) : readArrayChildren(parent);
}

function readObjectChildren(parent: JsonNode): { children: JsonNode[]; childIds: number[] } {
  const children: JsonNode[] = [];
  const childIds: number[] = [];
  let index = skipWhitespace((parent.valueStart ?? 0) + 1);

  if (sourceText[index] === "}") return { children, childIds };

  while (index < sourceText.length) {
    if (sourceText[index] !== "\"") throw new JsonScanError("Expected object key", index);
    const keyEnd = skipString(index);
    const key = safeJsonParse(sourceText.slice(index, keyEnd), "");
    index = skipWhitespace(keyEnd);
    if (sourceText[index] !== ":") throw new JsonScanError("Expected ':' after object key", index);
    index = skipWhitespace(index + 1);

    const child = readNode(index, key, parent.id, parent.depth + 1);
    children.push(child);
    childIds.push(child.id);
    index = skipWhitespace(child.valueEnd ?? index);

    if (sourceText[index] === "}") return { children, childIds };
    if (sourceText[index] !== ",") throw new JsonScanError("Expected ',' or '}'", index);
    index = skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated object", parent.valueStart ?? 0);
}

function readArrayChildren(parent: JsonNode): { children: JsonNode[]; childIds: number[] } {
  const children: JsonNode[] = [];
  const childIds: number[] = [];
  let itemIndex = 0;
  let index = skipWhitespace((parent.valueStart ?? 0) + 1);

  if (sourceText[index] === "]") return { children, childIds };

  while (index < sourceText.length) {
    const child = readNode(index, String(itemIndex), parent.id, parent.depth + 1);
    children.push(child);
    childIds.push(child.id);
    itemIndex += 1;
    index = skipWhitespace(child.valueEnd ?? index);

    if (sourceText[index] === "]") return { children, childIds };
    if (sourceText[index] !== ",") throw new JsonScanError("Expected ',' or ']'", index);
    index = skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated array", parent.valueStart ?? 0);
}

function countChildren(start: number, type: JsonNodeType): number {
  let count = 0;
  let index = skipWhitespace(start + 1);
  const close = type === "object" ? "}" : "]";
  if (sourceText[index] === close) return 0;

  while (index < sourceText.length) {
    if (type === "object") {
      if (sourceText[index] !== "\"") throw new JsonScanError("Expected object key", index);
      index = skipWhitespace(skipString(index));
      if (sourceText[index] !== ":") throw new JsonScanError("Expected ':' after object key", index);
      index = skipWhitespace(index + 1);
    }

    index = skipWhitespace(skipValue(index));
    count += 1;
    if (sourceText[index] === close) return count;
    if (sourceText[index] !== ",") throw new JsonScanError(`Expected ',' or '${close}'`, index);
    index = skipWhitespace(index + 1);
  }

  throw new JsonScanError(`Unterminated ${type}`, start);
}

function skipValue(start: number): number {
  const index = skipWhitespace(start);
  const char = sourceText[index];

  if (char === "\"") return skipString(index);
  if (char === "{") return skipObjectValue(index);
  if (char === "[") return skipArrayValue(index);
  if (char === "t" && sourceText.startsWith("true", index)) return index + 4;
  if (char === "f" && sourceText.startsWith("false", index)) return index + 5;
  if (char === "n" && sourceText.startsWith("null", index)) return index + 4;
  if (char === "-" || isDigit(char)) return skipNumber(index);

  throw new JsonScanError("Unexpected token", index);
}

function skipObjectValue(start: number): number {
  let index = skipWhitespace(start + 1);
  if (sourceText[index] === "}") return index + 1;

  while (index < sourceText.length) {
    if (sourceText[index] !== "\"") throw new JsonScanError("Expected object key", index);
    index = skipWhitespace(skipString(index));
    if (sourceText[index] !== ":") throw new JsonScanError("Expected ':' after object key", index);
    index = skipWhitespace(skipValue(index + 1));

    if (sourceText[index] === "}") return index + 1;
    if (sourceText[index] !== ",") throw new JsonScanError("Expected ',' or '}'", index);
    index = skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated object", start);
}

function skipArrayValue(start: number): number {
  let index = skipWhitespace(start + 1);
  if (sourceText[index] === "]") return index + 1;

  while (index < sourceText.length) {
    index = skipWhitespace(skipValue(index));

    if (sourceText[index] === "]") return index + 1;
    if (sourceText[index] !== ",") throw new JsonScanError("Expected ',' or ']'", index);
    index = skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated array", start);
}

function skipString(start: number): number {
  let index = start + 1;
  while (index < sourceText.length) {
    const char = sourceText[index];
    if (char === "\\") {
      const escape = sourceText[index + 1];
      if (escape === "u") {
        for (let offset = 2; offset < 6; offset += 1) {
          if (!isHexDigit(sourceText[index + offset])) {
            throw new JsonScanError("Invalid unicode escape", index);
          }
        }
        index += 6;
        continue;
      }

      if (!escape || !`"\\/bfnrt`.includes(escape)) {
        throw new JsonScanError("Invalid string escape", index);
      }

      index += 2;
      continue;
    }
    if (char === "\"") return index + 1;
    if (char.charCodeAt(0) < 0x20) throw new JsonScanError("Invalid control character in string", index);
    index += 1;
  }
  throw new JsonScanError("Unterminated string", start);
}

function skipNumber(start: number): number {
  let index = start;
  if (sourceText[index] === "-") index += 1;

  if (sourceText[index] === "0") {
    index += 1;
    if (isDigit(sourceText[index])) throw new JsonScanError("Invalid number", index);
  } else if (isDigitOneToNine(sourceText[index])) {
    while (isDigit(sourceText[index])) index += 1;
  } else {
    throw new JsonScanError("Invalid number", start);
  }

  if (sourceText[index] === ".") {
    index += 1;
    if (!isDigit(sourceText[index])) throw new JsonScanError("Invalid number", index);
    while (isDigit(sourceText[index])) index += 1;
  }

  if (sourceText[index] === "e" || sourceText[index] === "E") {
    index += 1;
    if (sourceText[index] === "+" || sourceText[index] === "-") index += 1;
    if (!isDigit(sourceText[index])) throw new JsonScanError("Invalid number", index);
    while (isDigit(sourceText[index])) index += 1;
  }

  return index;
}

function readType(start: number): JsonNodeType {
  const char = sourceText[start];
  if (char === "{") return "object";
  if (char === "[") return "array";
  if (char === "\"") return "string";
  if (char === "t" || char === "f") return "boolean";
  if (char === "n") return "null";
  if (char === "-" || isDigit(char)) return "number";
  throw new JsonScanError("Unexpected token", start);
}

function createPreview(start: number, end: number, type: JsonNodeType): string {
  if (type === "object") return "{...}";
  if (type === "array") return "[...]";

  const raw = sourceText.slice(start, Math.min(end, start + PREVIEW_LIMIT));
  return end - start > PREVIEW_LIMIT ? `${raw}...` : raw;
}

function createSearchableText(start: number, end: number, type: JsonNodeType): string {
  if (type === "object") return "{}";
  if (type === "array") return "[]";

  const raw = sourceText.slice(start, end);
  if (type === "string") {
    return safeJsonParse(raw, raw);
  }

  return raw;
}

function skipWhitespace(start: number): number {
  let index = start;
  while (/\s/.test(sourceText[index] ?? "")) index += 1;
  return index;
}

function isDigit(char: string | undefined): boolean {
  return !!char && char >= "0" && char <= "9";
}

function isDigitOneToNine(char: string | undefined): boolean {
  return !!char && char >= "1" && char <= "9";
}

function isHexDigit(char: string | undefined): boolean {
  return !!char && ((char >= "0" && char <= "9") || (char >= "a" && char <= "f") || (char >= "A" && char <= "F"));
}

function safeJsonParse<T>(text: string, fallback: T): string | T {
  try {
    return JSON.parse(text) as string;
  } catch {
    return fallback;
  }
}

function searchInText(text: string, query: string, limit: number): { nodeId: number }[] {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedQuery = query.toLocaleLowerCase();
  const results: { nodeId: number }[] = [];
  const seen = new Set<number>();
  let index = normalizedText.indexOf(normalizedQuery);

  while (index >= 0 && results.length < limit) {
    const node = findDeepestIndexedNode(index);
    if (node && !seen.has(node.id)) {
      seen.add(node.id);
      results.push({ nodeId: node.id });
    }
    index = normalizedText.indexOf(normalizedQuery, index + Math.max(1, normalizedQuery.length));
  }

  return results;
}

async function searchInBlob(blob: Blob, query: string, limit: number): Promise<{ nodeId: number }[]> {
  const normalizedQuery = query.toLocaleLowerCase();
  const decoder = new TextDecoder();
  const reader = blob.stream().getReader();
  const results: { nodeId: number }[] = [];
  const seen = new Set<number>();
  let scanned = 0;
  let carry = "";
  let done = false;

  while (!done && results.length < limit) {
    const next = await reader.read();
    done = next.done;
    const chunk = next.value ? decoder.decode(next.value, { stream: !done }) : "";
    const text = `${carry}${chunk}`;
    const normalizedText = text.toLocaleLowerCase();
    let index = normalizedText.indexOf(normalizedQuery);

    while (index >= 0 && results.length < limit) {
      const position = Math.max(0, scanned - carry.length + index);
      const node = findDeepestIndexedNode(position);
      if (node && !seen.has(node.id)) {
        seen.add(node.id);
        results.push({ nodeId: node.id });
      }
      index = normalizedText.indexOf(normalizedQuery, index + Math.max(1, normalizedQuery.length));
    }

    scanned += chunk.length;
    carry = text.slice(-Math.max(normalizedQuery.length - 1, 0));
  }

  return results;
}

function findDeepestIndexedNode(position: number): JsonNode | null {
  let best: JsonNode | null = null;

  for (const node of indexedNodes) {
    if (node.valueStart === undefined || node.valueEnd === undefined) continue;
    if (position < node.valueStart || position >= node.valueEnd) continue;
    if (!best || node.depth > best.depth) {
      best = node;
    }
  }

  return best;
}

function mergeIndexedNodes(nodes: JsonNode[]): void {
  const byId = new Map(indexedNodes.map((node) => [node.id, node]));
  for (const node of nodes) {
    byId.set(node.id, node);
  }
  indexedNodes = Array.from(byId.values());
}

interface StreamValueInfo {
  type: JsonNodeType;
  start: number;
  end: number;
  childCount: number;
}

async function readStreamChildren(
  parent: JsonNode,
  requestId: number
): Promise<{ children: JsonNode[]; childIds: number[] }> {
  if (!currentBlob || parent.valueStart === undefined || parent.valueEnd === undefined) {
    return { children: [], childIds: [] };
  }

  if (parent.type === "object") {
    return readStreamObjectChildren(parent, requestId);
  }

  if (parent.type === "array") {
    return readStreamArrayChildren(parent, requestId);
  }

  return { children: [], childIds: [] };
}

async function readStreamObjectChildren(
  parent: JsonNode,
  requestId: number
): Promise<{ children: JsonNode[]; childIds: number[] }> {
  if (!currentBlob || parent.valueStart === undefined) return { children: [], childIds: [] };

  const children: JsonNode[] = [];
  const childIds: number[] = [];
  const scanner = new BlobScanner(currentBlob.slice(parent.valueStart, parent.valueEnd), requestId, parent.valueStart);
  let index = await scanner.skipWhitespace(parent.valueStart + 1);

  if ((await scanner.byteAt(index)) === byte("}")) return { children, childIds };

  while (index < scanner.globalEnd) {
    if ((await scanner.byteAt(index)) !== byte("\"")) throw new JsonScanError("Expected object key", index);
    const keyEnd = await scanner.skipString(index);
    const key = safeJsonParse(await decodeBlobRange(currentBlob, index, keyEnd), "");
    index = await scanner.skipWhitespace(keyEnd);
    if ((await scanner.byteAt(index)) !== byte(":")) throw new JsonScanError("Expected ':' after object key", index);
    index = await scanner.skipWhitespace(index + 1);

    const info = await scanner.skipValue(index);
    const child = await createStreamNode(info, key, parent.id, parent.depth + 1, currentBlob);
    children.push(child);
    childIds.push(child.id);
    index = await scanner.skipWhitespace(info.end);

    const next = await scanner.byteAt(index);
    if (next === byte("}")) return { children, childIds };
    if (next !== byte(",")) throw new JsonScanError("Expected ',' or '}'", index);
    index = await scanner.skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated object", parent.valueStart);
}

async function readStreamArrayChildren(
  parent: JsonNode,
  requestId: number
): Promise<{ children: JsonNode[]; childIds: number[] }> {
  if (!currentBlob || parent.valueStart === undefined) return { children: [], childIds: [] };

  const children: JsonNode[] = [];
  const childIds: number[] = [];
  const scanner = new BlobScanner(currentBlob.slice(parent.valueStart, parent.valueEnd), requestId, parent.valueStart);
  let itemIndex = 0;
  let index = await scanner.skipWhitespace(parent.valueStart + 1);

  if ((await scanner.byteAt(index)) === byte("]")) return { children, childIds };

  while (index < scanner.globalEnd) {
    const info = await scanner.skipValue(index);
    const child = await createStreamNode(info, String(itemIndex), parent.id, parent.depth + 1, currentBlob);
    children.push(child);
    childIds.push(child.id);
    itemIndex += 1;
    index = await scanner.skipWhitespace(info.end);

    const next = await scanner.byteAt(index);
    if (next === byte("]")) return { children, childIds };
    if (next !== byte(",")) throw new JsonScanError("Expected ',' or ']'", index);
    index = await scanner.skipWhitespace(index + 1);
  }

  throw new JsonScanError("Unterminated array", parent.valueStart);
}

async function createStreamNode(
  info: StreamValueInfo,
  key: string | null,
  parentId: number | null,
  depth: number,
  blob: Blob
): Promise<JsonNode> {
  return {
    id: nextNodeId++,
    parentId,
    key,
    type: info.type,
    depth,
    valuePreview: await createStreamPreview(blob, info),
    searchableText: await createStreamSearchableText(blob, info),
    valueStart: info.start,
    valueEnd: info.end,
    childCount: info.childCount
  };
}

async function createStreamPreview(blob: Blob, info: StreamValueInfo): Promise<string> {
  if (info.type === "object") return "{...}";
  if (info.type === "array") return "[...]";

  const raw = await decodeBlobRange(blob, info.start, Math.min(info.end, info.start + PREVIEW_LIMIT));
  return info.end - info.start > PREVIEW_LIMIT ? `${raw}...` : raw;
}

async function createStreamSearchableText(blob: Blob, info: StreamValueInfo): Promise<string> {
  if (info.type === "object") return "{}";
  if (info.type === "array") return "[]";

  const raw = await decodeBlobRange(blob, info.start, Math.min(info.end, info.start + PREVIEW_LIMIT));
  if (info.type === "string") {
    return safeJsonParse(raw, raw);
  }

  return raw;
}

async function decodeBlobRange(blob: Blob, start: number, end: number): Promise<string> {
  return new TextDecoder().decode(await blob.slice(start, end).arrayBuffer());
}

function byte(char: string): number {
  return char.charCodeAt(0);
}

class BlobScanner {
  private buffer = new Uint8Array(0);
  private bufferStart = 0;
  private loaded = 0;
  private ended = false;
  private lastProgress = 0;
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;

  constructor(
    private readonly blob: Blob,
    private readonly requestId: number,
    private readonly baseOffset = 0
  ) {
    this.bufferStart = baseOffset;
    this.reader = blob.stream().getReader();
  }

  get globalEnd(): number {
    return this.baseOffset + this.blob.size;
  }

  async byteAt(globalOffset: number): Promise<number | undefined> {
    if (globalOffset < this.baseOffset || globalOffset >= this.globalEnd) return undefined;
    await this.ensure(globalOffset);
    const local = globalOffset - this.bufferStart;
    return this.buffer[local];
  }

  async skipWhitespace(start = this.baseOffset): Promise<number> {
    let index = start;
    while (index < this.globalEnd) {
      const current = await this.byteAt(index);
      if (current !== 0x20 && current !== 0x0a && current !== 0x0d && current !== 0x09) return index;
      index += 1;
    }
    return index;
  }

  async skipValue(start: number): Promise<StreamValueInfo> {
    const index = await this.skipWhitespace(start);
    const current = await this.byteAt(index);

    if (current === byte("\"")) {
      return { type: "string", start: index, end: await this.skipString(index), childCount: 0 };
    }
    if (current === byte("{")) return this.skipObject(index);
    if (current === byte("[")) return this.skipArray(index);
    if (current === byte("t")) return { type: "boolean", start: index, end: await this.skipLiteral(index, "true"), childCount: 0 };
    if (current === byte("f")) return { type: "boolean", start: index, end: await this.skipLiteral(index, "false"), childCount: 0 };
    if (current === byte("n")) return { type: "null", start: index, end: await this.skipLiteral(index, "null"), childCount: 0 };
    if (current === byte("-") || isDigitByte(current)) {
      return { type: "number", start: index, end: await this.skipNumber(index), childCount: 0 };
    }

    throw new JsonScanError("Unexpected token", index);
  }

  async skipObject(start: number): Promise<StreamValueInfo> {
    let count = 0;
    let index = await this.skipWhitespace(start + 1);
    if ((await this.byteAt(index)) === byte("}")) return { type: "object", start, end: index + 1, childCount: 0 };

    while (index < this.globalEnd) {
      if ((await this.byteAt(index)) !== byte("\"")) throw new JsonScanError("Expected object key", index);
      index = await this.skipWhitespace(await this.skipString(index));
      if ((await this.byteAt(index)) !== byte(":")) throw new JsonScanError("Expected ':' after object key", index);
      const child = await this.skipValue(index + 1);
      count += 1;
      index = await this.skipWhitespace(child.end);

      const next = await this.byteAt(index);
      if (next === byte("}")) return { type: "object", start, end: index + 1, childCount: count };
      if (next !== byte(",")) throw new JsonScanError("Expected ',' or '}'", index);
      index = await this.skipWhitespace(index + 1);
    }

    throw new JsonScanError("Unterminated object", start);
  }

  async skipArray(start: number): Promise<StreamValueInfo> {
    let count = 0;
    let index = await this.skipWhitespace(start + 1);
    if ((await this.byteAt(index)) === byte("]")) return { type: "array", start, end: index + 1, childCount: 0 };

    while (index < this.globalEnd) {
      const child = await this.skipValue(index);
      count += 1;
      index = await this.skipWhitespace(child.end);

      const next = await this.byteAt(index);
      if (next === byte("]")) return { type: "array", start, end: index + 1, childCount: count };
      if (next !== byte(",")) throw new JsonScanError("Expected ',' or ']'", index);
      index = await this.skipWhitespace(index + 1);
    }

    throw new JsonScanError("Unterminated array", start);
  }

  async skipString(start: number): Promise<number> {
    let index = start + 1;
    while (index < this.globalEnd) {
      const current = await this.byteAt(index);
      if (current === byte("\\")) {
        const escape = await this.byteAt(index + 1);
        if (escape === byte("u")) {
          for (let offset = 2; offset < 6; offset += 1) {
            if (!isHexDigitByte(await this.byteAt(index + offset))) {
              throw new JsonScanError("Invalid unicode escape", index);
            }
          }
          index += 6;
          continue;
        }

        if (!isValidEscapeByte(escape)) throw new JsonScanError("Invalid string escape", index);
        index += 2;
        continue;
      }

      if (current === byte("\"")) return index + 1;
      if (current === undefined || current < 0x20) throw new JsonScanError("Invalid control character in string", index);
      index += 1;
    }

    throw new JsonScanError("Unterminated string", start);
  }

  async skipNumber(start: number): Promise<number> {
    let index = start;
    if ((await this.byteAt(index)) === byte("-")) index += 1;

    const first = await this.byteAt(index);
    if (first === byte("0")) {
      index += 1;
      if (isDigitByte(await this.byteAt(index))) throw new JsonScanError("Invalid number", index);
    } else if (isDigitOneToNineByte(first)) {
      while (isDigitByte(await this.byteAt(index))) index += 1;
    } else {
      throw new JsonScanError("Invalid number", start);
    }

    if ((await this.byteAt(index)) === byte(".")) {
      index += 1;
      if (!isDigitByte(await this.byteAt(index))) throw new JsonScanError("Invalid number", index);
      while (isDigitByte(await this.byteAt(index))) index += 1;
    }

    const exponent = await this.byteAt(index);
    if (exponent === byte("e") || exponent === byte("E")) {
      index += 1;
      const sign = await this.byteAt(index);
      if (sign === byte("+") || sign === byte("-")) index += 1;
      if (!isDigitByte(await this.byteAt(index))) throw new JsonScanError("Invalid number", index);
      while (isDigitByte(await this.byteAt(index))) index += 1;
    }

    return index;
  }

  async skipLiteral(start: number, literal: "true" | "false" | "null"): Promise<number> {
    for (let index = 0; index < literal.length; index += 1) {
      if ((await this.byteAt(start + index)) !== byte(literal[index])) {
        throw new JsonScanError("Unexpected token", start);
      }
    }

    return start + literal.length;
  }

  private async ensure(globalOffset: number): Promise<void> {
    while (!this.ended && globalOffset >= this.bufferStart + this.buffer.length) {
      const next = await this.reader.read();
      if (next.done) {
        this.ended = true;
        break;
      }

      const combined = new Uint8Array(this.buffer.length + next.value.length);
      combined.set(this.buffer);
      combined.set(next.value, this.buffer.length);
      this.buffer = combined;
      this.loaded += next.value.length;
      this.reportProgress();
    }

    const discard = globalOffset - this.bufferStart - 64;
    if (discard > 1024 * 1024) {
      this.buffer = this.buffer.slice(discard);
      this.bufferStart += discard;
    }
  }

  private reportProgress(): void {
    const globalLoaded = this.baseOffset + this.loaded;
    if (globalLoaded - this.lastProgress < 8 * 1024 * 1024 && globalLoaded < this.globalEnd) return;

    this.lastProgress = globalLoaded;
    postResponse({
      type: "progress",
      requestId: this.requestId,
      stage: "parsing",
      parsed: Math.min(globalLoaded, this.globalEnd),
      total: this.globalEnd
    });
  }
}

function isDigitByte(value: number | undefined): boolean {
  return value !== undefined && value >= byte("0") && value <= byte("9");
}

function isDigitOneToNineByte(value: number | undefined): boolean {
  return value !== undefined && value >= byte("1") && value <= byte("9");
}

function isHexDigitByte(value: number | undefined): boolean {
  return (
    value !== undefined &&
    ((value >= byte("0") && value <= byte("9")) ||
      (value >= byte("a") && value <= byte("f")) ||
      (value >= byte("A") && value <= byte("F")))
  );
}

function isValidEscapeByte(value: number | undefined): boolean {
  return (
    value === byte("\"") ||
    value === byte("\\") ||
    value === byte("/") ||
    value === byte("b") ||
    value === byte("f") ||
    value === byte("n") ||
    value === byte("r") ||
    value === byte("t")
  );
}

function postStreamError(error: unknown, requestId: number): void {
  postResponse({
    type: "error",
    requestId,
    message: getErrorMessage(error),
    position: error instanceof JsonScanError ? error.position : undefined
  });
}

class JsonScanError extends Error {
  constructor(message: string, public position: number) {
    super(message);
  }
}

function getLineColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  for (let index = 0; index < position && index < text.length; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }
  return { line, column };
}

function postResponse(response: ParserResponse): void {
  ctx.postMessage(response);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof RangeError) {
    return "File is too large to load into the browser string parser";
  }

  return error instanceof Error ? error.message : "Invalid JSON";
}
