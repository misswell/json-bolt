import { flattenJson } from "./tree";
import type { ParseResult } from "./types";

export function parseJson(text: string): ParseResult {
  return flattenJson(JSON.parse(text));
}
