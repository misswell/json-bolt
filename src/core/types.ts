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
  offsetUnit?: "utf16" | "byte";
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
      expandRequestId: number;
      nodeId: number;
      valueStart: number;
      depth: number;
    }
  | {
      type: "search";
      requestId: number;
      query: string;
      limit: number;
    }
  | {
      type: "readValue";
      requestId: number;
      valueRequestId: number;
      nodeId: number;
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
      expandRequestId: number;
      nodeId: number;
      children: JsonNode[];
      childIds: number[];
    }
  | {
      type: "search";
      requestId: number;
      query: string;
      matches: SearchMatch[];
    }
  | {
      type: "value";
      requestId: number;
      valueRequestId: number;
      nodeId: number;
      text?: string;
      error?: string;
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
