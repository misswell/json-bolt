import type { Messages } from "../core/i18n";
import type { JsonNode } from "../core/types";

interface JsonRowProps {
  labels: Messages;
  node: JsonNode;
  isExpanded: boolean;
  isMatched: boolean;
  isActiveMatch: boolean;
  onToggle: (id: number) => void;
  onCopy: (id: number) => void;
  isCopying: boolean;
}

export function JsonRow({
  labels,
  node,
  isExpanded,
  isMatched,
  isActiveMatch,
  onToggle,
  onCopy,
  isCopying
}: JsonRowProps) {
  const expandable = node.childCount > 0;
  const typeClass = `json-type json-type-${node.type}`;

  return (
    <div
      className={`json-row${isMatched ? " is-match" : ""}${isActiveMatch ? " is-active-match" : ""}`}
      style={{ paddingLeft: `calc(${node.depth} * 4ch + 8px)` }}
    >
      <button
        type="button"
        className="twisty"
        onClick={() => expandable && onToggle(node.id)}
        disabled={!expandable}
        aria-label={isExpanded ? labels.collapseNode : labels.expandNode}
      >
        {expandable ? (isExpanded ? "v" : ">") : ""}
      </button>
      {node.key !== null && <span className="json-key">{JSON.stringify(node.key)}: </span>}
      <span className={typeClass}>
        {node.type === "object" ? "{}" : node.type === "array" ? "[]" : node.valuePreview}
      </span>
      {expandable && (
        <span className="json-count">
          {node.childCount} {node.type === "array" ? labels.items : labels.keys}
        </span>
      )}
      <button
        type="button"
        className="copy-node"
        onClick={() => onCopy(node.id)}
        title={labels.copyValueTitle}
        aria-label={labels.copyValueTitle}
        disabled={isCopying}
      >
        {labels.copyValue}
      </button>
    </div>
  );
}
