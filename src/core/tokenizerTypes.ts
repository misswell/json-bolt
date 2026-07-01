export type JsonToken =
  | { type: "braceOpen"; start: number; end: number }
  | { type: "braceClose"; start: number; end: number }
  | { type: "bracketOpen"; start: number; end: number }
  | { type: "bracketClose"; start: number; end: number }
  | { type: "colon"; start: number; end: number }
  | { type: "comma"; start: number; end: number }
  | { type: "string"; start: number; end: number }
  | { type: "number"; start: number; end: number }
  | { type: "boolean"; start: number; end: number }
  | { type: "null"; start: number; end: number };
