export type JsonNodeType =
  | "object"
  | "array"
  | "string"
  | "number"
  | "boolean"
  | "null";

export interface JsonNode {
  id: number;
  parentId: number | null;
  key: string | null;
  type: JsonNodeType;
  depth: number;
  valuePreview: string;
  searchableText?: string;
  valueStart?: number;
  valueEnd?: number;
  children?: number[];
  childCount: number;
}

export interface ParseResult {
  nodes: JsonNode[];
  rootIds: number[];
}

export type ParserRequest =
  | {
      type: "parse";
      text?: string;
      blob?: Blob;
      requestId: number;
    }
  | {
      type: "expand";
      requestId: number;
      nodeId: number;
      valueStart: number;
      depth: number;
    };

export type ParserStage = "reading" | "parsing" | "building" | "done";

export type ParserResponse =
  | {
      type: "progress";
      requestId: number;
      stage: ParserStage;
      parsed: number;
      total: number;
    }
  | {
      type: "success";
      requestId: number;
      nodes: JsonNode[];
      rootIds: number[];
    }
  | {
      type: "expanded";
      requestId: number;
      nodeId: number;
      children: JsonNode[];
      childIds: number[];
    }
  | {
      type: "error";
      requestId: number;
      message: string;
      position?: number;
      line?: number;
      column?: number;
    };

export interface SearchMatch {
  nodeId: number;
}
