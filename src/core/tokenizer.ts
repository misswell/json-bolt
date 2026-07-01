import type { JsonToken } from "./tokenizerTypes";

export function tokenizeJson(source: string): JsonToken[] {
  const tokens: JsonToken[] = [];
  let index = 0;

  while (index < source.length) {
    const char = source[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }

    if (char === "{") tokens.push({ type: "braceOpen", start: index, end: index + 1 });
    else if (char === "}") tokens.push({ type: "braceClose", start: index, end: index + 1 });
    else if (char === "[") tokens.push({ type: "bracketOpen", start: index, end: index + 1 });
    else if (char === "]") tokens.push({ type: "bracketClose", start: index, end: index + 1 });
    else if (char === ":") tokens.push({ type: "colon", start: index, end: index + 1 });
    else if (char === ",") tokens.push({ type: "comma", start: index, end: index + 1 });
    else if (char === "\"") {
      const start = index;
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "\"") break;
        index += 1;
      }
      if (source[index] !== "\"") throw new SyntaxError(`Unterminated string at ${start}`);
      tokens.push({ type: "string", start, end: index + 1 });
    } else if (/[0-9-]/.test(char)) {
      const start = index;
      index += 1;
      while (index < source.length && /[0-9.eE+-]/.test(source[index])) index += 1;
      tokens.push({ type: "number", start, end: index });
      continue;
    } else if (source.startsWith("true", index) || source.startsWith("false", index)) {
      const value = source.startsWith("true", index) ? "true" : "false";
      tokens.push({ type: "boolean", start: index, end: index + value.length });
      index += value.length;
      continue;
    } else if (source.startsWith("null", index)) {
      tokens.push({ type: "null", start: index, end: index + 4 });
      index += 4;
      continue;
    } else {
      throw new SyntaxError(`Unexpected token at ${index}`);
    }

    index += 1;
  }

  return tokens;
}
