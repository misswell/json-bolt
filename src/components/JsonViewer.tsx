import { useEffect, useMemo, useRef } from "react";
import { FixedSizeList, type ListOnItemsRenderedProps } from "react-window";
import type { Messages } from "../core/i18n";
import type { JsonNode } from "../core/types";
import { JsonRow } from "./JsonRow";

interface JsonViewerProps {
  labels: Messages;
  visibleNodes: JsonNode[];
  expandedIds: Set<number>;
  matchedIds: Set<number>;
  activeMatchId: number | null;
  searchScrollTargetId: number | null;
  searchScrollSignal: number;
  onToggle: (id: number) => void;
  onVisibleRangeChange: (startIndex: number, stopIndex: number) => void;
}

const ROW_HEIGHT = 28;

export function JsonViewer({
  labels,
  visibleNodes,
  expandedIds,
  matchedIds,
  activeMatchId,
  searchScrollTargetId,
  searchScrollSignal,
  onToggle,
  onVisibleRangeChange
}: JsonViewerProps) {
  const height = Math.max(240, Math.min(620, window.innerHeight - 330));
  const listRef = useRef<FixedSizeList | null>(null);
  const scrollTargetIndex = useMemo(
    () => visibleNodes.findIndex((node) => node.id === searchScrollTargetId),
    [searchScrollTargetId, visibleNodes]
  );

  useEffect(() => {
    if (scrollTargetIndex < 0) return;
    listRef.current?.scrollToItem(scrollTargetIndex, "center");
  }, [searchScrollTargetId, scrollTargetIndex, searchScrollSignal, visibleNodes]);

  const handleItemsRendered = ({ visibleStartIndex, visibleStopIndex }: ListOnItemsRenderedProps) => {
    onVisibleRangeChange(visibleStartIndex, visibleStopIndex);
  };

  if (visibleNodes.length === 0) {
    return <div className="empty-state">{labels.emptyState}</div>;
  }

  return (
    <div className="viewer">
      <FixedSizeList
        ref={listRef}
        height={height}
        itemCount={visibleNodes.length}
        itemSize={ROW_HEIGHT}
        width="100%"
        onItemsRendered={handleItemsRendered}
      >
        {({ index, style }) => {
          const node = visibleNodes[index];
          return (
            <div style={style}>
              <JsonRow
                labels={labels}
                node={node}
                isExpanded={expandedIds.has(node.id)}
                isMatched={matchedIds.has(node.id)}
                isActiveMatch={activeMatchId === node.id}
                onToggle={onToggle}
              />
            </div>
          );
        }}
      </FixedSizeList>
    </div>
  );
}
