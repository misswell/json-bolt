import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatJson, minifyJson } from "../core/formatter";
import { getMessages } from "../core/i18n";
import { buildVisibleNodes, collectExpandableIds } from "../core/tree";
import { searchNodes } from "../core/search";
import type { JsonNode, ParserResponse, SearchMatch } from "../core/types";
import { JsonViewer } from "./JsonViewer";
import { SearchBox } from "./SearchBox";
import { Toolbar } from "./Toolbar";

const INITIAL_SOURCE = "";
const TEXTAREA_PREVIEW_MAX_CHARS = 200_000;
const LARGE_SOURCE_CHARS = 1_000_000;
const AUTO_PARSE_DELAY_MS = 650;

interface AppProps {
  surface: "page" | "sidepanel";
}

export function App({ surface }: AppProps) {
  const labels = useMemo(() => getMessages(), []);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sourceTextRef = useRef(INITIAL_SOURCE);
  const sourceBlobRef = useRef<Blob | null>(null);
  const autoParseTimerRef = useRef<number | null>(null);
  const latestRequestIdRef = useRef(0);
  const debouncedQueryRef = useRef("");
  const dragDepthRef = useRef(0);
  const [sourceInfo, setSourceInfo] = useState({
    hasText: INITIAL_SOURCE.length > 0,
    sizeLabel: formatBytes(new Blob([INITIAL_SOURCE]).size)
  });
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [nodes, setNodes] = useState<JsonNode[]>([]);
  const [rootIds, setRootIds] = useState<number[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [workerMatches, setWorkerMatches] = useState<SearchMatch[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, stop: 0 });
  const [expandLevel, setExpandLevel] = useState(2);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../worker/jsonParser.worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ParserResponse>) => {
      const response = event.data;
      if (response.requestId !== latestRequestIdRef.current) return;

      if (response.type === "progress") {
        setProgress(response.total === 0 ? 0 : response.parsed / response.total);
        const stage = labels.parseStages[response.stage];
        const percent = Math.max(0, Math.min(100, Math.round((response.parsed / response.total) * 100)));
        setNotice(labels.parseProgress(stage, percent));
        return;
      }

      if (response.type === "error") {
        setIsParsing(false);
        setProgress(0);
        setNotice(null);
        const location =
          response.line && response.column
            ? labels.errorLocation(response.line, response.column)
            : response.position !== undefined
              ? labels.errorPosition(response.position)
              : "";
        setError(`${response.message}${location}`);
        setNodes([]);
        setRootIds([]);
        setExpandedIds(new Set());
        setWorkerMatches([]);
        setActiveMatchIndex(0);
        return;
      }

      if (response.type === "search") {
        if (response.query.trim() === debouncedQueryRef.current.trim()) {
          setWorkerMatches(response.matches);
        }
        return;
      }

      if (response.type === "expanded") {
        setNodes((current) => {
          const existingIds = new Set(current.map((node) => node.id));
          const next = current.map((node) =>
            node.id === response.nodeId ? { ...node, children: response.childIds } : node
          );
          for (const child of response.children) {
            if (!existingIds.has(child.id)) next.push(child);
          }
          return next;
        });
        setExpandedIds((current) => new Set(current).add(response.nodeId));
        setProgress(0);
        setNotice(null);
        return;
      }

      setIsParsing(false);
      setError(null);
      setNotice(null);
      setNodes(response.nodes);
      setRootIds(response.rootIds);
      setExpandedIds(new Set(response.rootIds));
      setWorkerMatches([]);
      setProgress(0);
      setActiveMatchIndex(0);
    };

    return () => {
      if (autoParseTimerRef.current !== null) {
        window.clearTimeout(autoParseTimerRef.current);
      }
      worker.terminate();
    };
  }, [labels]);

  useEffect(() => {
    window.setTimeout(() => parseCurrentSource(), 0);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      if (modifier && event.key === "Enter") {
        event.preventDefault();
        parseCurrentSource();
        return;
      }

      if (modifier && event.shiftKey && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        updateSourceSafely(formatJson);
        return;
      }

      if (modifier && event.key.toLocaleLowerCase() === "f") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "Escape") {
        setError(null);
        setNotice(null);
        setQuery("");
      }
    };

    document.addEventListener("keydown", handleKeydown, true);
    return () => document.removeEventListener("keydown", handleKeydown, true);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const text = event.clipboardData?.getData("text");
      if (!text) return;

      event.preventDefault();
      replaceSourceAndParse(text);
    };

    document.addEventListener("paste", handlePaste);
    return () => document.removeEventListener("paste", handlePaste);
  }, []);

  const nodesById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const visibleNodes = useMemo(
    () => buildVisibleNodes(rootIds, nodesById, expandedIds),
    [rootIds, nodesById, expandedIds]
  );
  const localMatches = useMemo<SearchMatch[]>(
    () => searchNodes(nodes, debouncedQuery),
    [nodes, debouncedQuery]
  );
  const matches = useMemo<SearchMatch[]>(() => mergeMatches(localMatches, workerMatches), [localMatches, workerMatches]);
  const matchedIds = useMemo(() => new Set(matches.map((match) => match.nodeId)), [matches]);
  const activeMatchId = matches[activeMatchIndex]?.nodeId ?? null;

  useEffect(() => {
    debouncedQueryRef.current = debouncedQuery;
    setWorkerMatches([]);

    if (!debouncedQuery.trim() || !workerRef.current) return;

    workerRef.current.postMessage({
      type: "search",
      requestId: latestRequestIdRef.current,
      query: debouncedQuery,
      limit: 500
    });
  }, [debouncedQuery, nodes.length]);

  useEffect(() => {
    setActiveMatchIndex(0);
    const targetId = matches[0]?.nodeId;
    if (targetId === undefined) return;

    setExpandedIds((current) => {
      const next = new Set(current);
      let node = nodesById.get(targetId);

      while (node?.parentId !== null && node?.parentId !== undefined) {
        next.add(node.parentId);
        node = nodesById.get(node.parentId);
      }

      return next;
    });
  }, [matches, nodesById]);

  function getSource() {
    return sourceTextRef.current;
  }

  function setSourceText(text: string, exactSize = false) {
    sourceBlobRef.current = null;
    sourceTextRef.current = text;
    if (inputRef.current) {
      inputRef.current.value = createInputPreview(text);
    }
    setIsPreviewMode(text.length > TEXTAREA_PREVIEW_MAX_CHARS);
    setSourceInfo({
      hasText: text.length > 0,
      sizeLabel: getSourceSizeLabel(text, exactSize)
    });
  }

  function setSourceFile(file: File, preview: string) {
    sourceBlobRef.current = file;
    sourceTextRef.current = preview;
    if (inputRef.current) {
      inputRef.current.value = createInputPreview(preview);
    }
    setIsPreviewMode(true);
    setSourceInfo({
      hasText: file.size > 0,
      sizeLabel: formatBytes(file.size)
    });
  }

  function refreshSourceInfo(text = getSource(), exactSize = false) {
    setSourceInfo({
      hasText: text.length > 0,
      sizeLabel: getSourceSizeLabel(text, exactSize)
    });
  }

  function parseCurrentSource() {
    if (sourceBlobRef.current) {
      parseBlobSource(sourceBlobRef.current);
      return;
    }

    parseSource(getSource());
  }

  function parseSource(source: string) {
    if (!source || !workerRef.current) return;
    refreshSourceInfo(source, true);
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsParsing(true);
    setProgress(0);
    setError(null);
    setWorkerMatches([]);
    setNotice(source.length > LARGE_SOURCE_CHARS ? labels.parsingLarge : null);

    if (source.length > LARGE_SOURCE_CHARS) {
      workerRef.current.postMessage({
        type: "parse",
        blob: new Blob([source], { type: "application/json" }),
        requestId
      });
      return;
    }

    workerRef.current.postMessage({ type: "parse", text: source, requestId });
  }

  function parseBlobSource(blob: Blob) {
    if (!workerRef.current) return;
    const requestId = latestRequestIdRef.current + 1;
    latestRequestIdRef.current = requestId;
    setIsParsing(true);
    setProgress(0);
    setError(null);
    setWorkerMatches([]);
    setNotice(labels.parsingLarge);
    workerRef.current.postMessage({ type: "parse", blob, requestId });
  }

  function cancelAutoParse() {
    if (autoParseTimerRef.current !== null) {
      window.clearTimeout(autoParseTimerRef.current);
      autoParseTimerRef.current = null;
    }
  }

  function scheduleAutoParse() {
    cancelAutoParse();
    autoParseTimerRef.current = window.setTimeout(() => {
      autoParseTimerRef.current = null;
      parseCurrentSource();
    }, AUTO_PARSE_DELAY_MS);
  }

  const updateSourceSafely = (updater: (text: string) => string) => {
    try {
      const source = getSource();
      if (source.length > LARGE_SOURCE_CHARS) {
        setNotice(labels.formatPaused);
        return;
      }
      const next = updater(source);
      setSourceText(next, true);
      setError(null);
      parseSource(next);
    } catch (formatError) {
      setError(formatError instanceof Error ? formatError.message : "Invalid JSON");
    }
  };

  const copySource = async () => {
    await navigator.clipboard.writeText(getSource());
    setNotice(labels.copied);
  };

  function replaceSourceAndParse(text: string, nextNotice?: string | null) {
    cancelAutoParse();
    setSourceText(text);
    setError(null);
    setNotice(nextNotice ?? (text.length > TEXTAREA_PREVIEW_MAX_CHARS ? labels.largeInputPreview : null));
    window.setTimeout(() => parseSource(text), 0);
  }

  const pasteReplace = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        setNotice(labels.clipboardEmpty);
        return;
      }

      replaceSourceAndParse(text);
    } catch {
      setError(labels.clipboardReadFailed);
    }
  };

  const loadDroppedFile = async (file: File) => {
    try {
      cancelAutoParse();
      const preview = await file.slice(0, TEXTAREA_PREVIEW_MAX_CHARS).text();
      setSourceFile(file, preview);
      setNodes([]);
      setRootIds([]);
      setExpandedIds(new Set());
      setWorkerMatches([]);

      setError(null);
      setNotice(labels.fileLoaded(file.name));
      window.setTimeout(() => parseBlobSource(file), 0);
    } catch {
      setError(labels.fileReadFailed);
    }
  };

  const handleDragEnter = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDroppableContent(event.dataTransfer)) return;

    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDraggingFile(true);
  };

  const handleDragOver = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDroppableContent(event.dataTransfer)) return;

    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDroppableContent(event.dataTransfer)) return;

    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDraggingFile(false);
    }
  };

  const handleDrop = (event: React.DragEvent<HTMLElement>) => {
    if (!hasDroppableContent(event.dataTransfer)) return;

    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDraggingFile(false);

    const [file] = Array.from(event.dataTransfer.files);
    if (file) {
      void loadDroppedFile(file);
      return;
    }

    const text = event.dataTransfer.getData("text");
    if (text) {
      replaceSourceAndParse(text);
    }
  };

  const readCurrentPage = async (sourceTabId?: number, shouldParse = false) => {
    if (typeof chrome === "undefined" || !chrome.tabs || !chrome.scripting) {
      setError(labels.pageCaptureUnavailable);
      return;
    }

    let tabId = sourceTabId;
    if (!tabId) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      tabId = tab.id;
    }
    if (!tabId) return;

    try {
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => document.body?.textContent ?? document.documentElement?.textContent ?? ""
      });

      if (typeof result === "string" && result.length > 0) {
        setSourceText(result);
        setError(null);
        if (shouldParse) {
          parseSource(result);
        }
      } else {
        setError(labels.noReadableJson);
      }
    } catch (pageError) {
      setError(pageError instanceof Error ? pageError.message : labels.unableReadPage);
    }
  };

  const toggleNode = (id: number) => {
    const node = nodesById.get(id);
    if (!node) return;

    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        return next;
      }

      if (node.childCount > 0 && !node.children && node.valueStart !== undefined && workerRef.current) {
        workerRef.current.postMessage({
          type: "expand",
          requestId: latestRequestIdRef.current,
          nodeId: node.id,
          valueStart: node.valueStart,
          depth: node.depth
        });
        setNotice(labels.parseProgress(labels.parseStages.building, 0));
        return next;
      }

      next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const expandable = collectExpandableIds(nodes);
    setExpandedIds(new Set(expandable));
  };

  const expandToLevel = (level: number) => {
    const normalized = Number.isFinite(level) ? Math.max(1, Math.floor(level)) : 1;
    setExpandLevel(normalized);
    setExpandedIds(
      new Set(
        nodes
          .filter((node) => node.childCount > 0 && node.depth < normalized)
          .map((node) => node.id)
      )
    );
  };

  const collapseAll = () => setExpandedIds(new Set(rootIds));

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => {
      const next = (current + direction + matches.length) % matches.length;
      const targetId = matches[next]?.nodeId;
      if (targetId !== undefined) revealNode(targetId);
      return next;
    });
  };

  const revealNode = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      let node = nodesById.get(id);

      while (node?.parentId !== null && node?.parentId !== undefined) {
        next.add(node.parentId);
        node = nodesById.get(node.parentId);
      }

      return next;
    });
  };

  const stats = `${nodes.length.toLocaleString()} nodes | ${sourceInfo.sizeLabel} | visible ${visibleRange.start + 1}-${Math.min(visibleRange.stop + 1, visibleNodes.length)} of ${visibleNodes.length.toLocaleString()}`;

  return (
    <main className={`app app-${surface}`}>
      <header className="app-header">
        <div>
          <h1>JsonBolt</h1>
          <p>{stats}</p>
        </div>
        <p className="shortcut-hint">{labels.shortcutsHint}</p>
        {isParsing && (
          <div className="progress" aria-label="Parse progress">
            <span style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
        )}
      </header>

      <Toolbar
        labels={labels}
        canParse={sourceInfo.hasText}
        isParsing={isParsing}
        expandLevel={expandLevel}
        onExpandLevelChange={expandToLevel}
        onParse={parseCurrentSource}
        onPasteReplace={pasteReplace}
        onReadPage={() => readCurrentPage(undefined, true)}
        onFormat={() => updateSourceSafely(formatJson)}
        onMinify={() => updateSourceSafely(minifyJson)}
        onCopy={copySource}
        onClear={() => {
          cancelAutoParse();
          sourceBlobRef.current = null;
          setSourceText("");
          setNodes([]);
          setRootIds([]);
          setExpandedIds(new Set());
          setWorkerMatches([]);
          setError(null);
          setNotice(null);
        }}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
      />

      <section
        className={`workspace${isDraggingFile ? " is-dragging-file" : ""}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <textarea
          ref={inputRef}
          defaultValue={INITIAL_SOURCE}
          onInput={(event) => {
            const text = event.currentTarget.value;
            sourceTextRef.current = text;
            if (isPreviewMode) {
              setIsPreviewMode(false);
            }
            refreshSourceInfo(text);
            setNotice(text.length > LARGE_SOURCE_CHARS ? labels.largeInputDetected : null);
            scheduleAutoParse();
          }}
          onPaste={(event) => {
            const text = event.clipboardData.getData("text");
            event.preventDefault();
            if (text) {
              replaceSourceAndParse(text);
            }
          }}
          readOnly={isPreviewMode}
          spellCheck={false}
          aria-label={labels.jsonInputLabel}
        />
        {isDraggingFile && <div className="drop-hint">{labels.dropFileHint}</div>}
        <div className="tree-pane">
          <SearchBox
            labels={labels}
            inputRef={searchInputRef}
            value={query}
            currentIndex={activeMatchIndex}
            matchCount={matches.length}
            onChange={setQuery}
            onPrevious={() => goToMatch(-1)}
            onNext={() => goToMatch(1)}
          />
          {error && <div className="error">{error}</div>}
          {notice && <div className="notice">{notice}</div>}
          <JsonViewer
            labels={labels}
            visibleNodes={visibleNodes}
            expandedIds={expandedIds}
            matchedIds={matchedIds}
            activeMatchId={activeMatchId}
            onToggle={toggleNode}
            onVisibleRangeChange={(start, stop) => setVisibleRange({ start, stop })}
          />
        </div>
      </section>
    </main>
  );
}

function hasDroppableContent(dataTransfer: DataTransfer): boolean {
  return dataTransfer.types.includes("Files") || dataTransfer.types.includes("text/plain");
}

function mergeMatches(primary: SearchMatch[], secondary: SearchMatch[]): SearchMatch[] {
  const seen = new Set<number>();
  const merged: SearchMatch[] = [];

  for (const match of [...primary, ...secondary]) {
    if (seen.has(match.nodeId)) continue;
    seen.add(match.nodeId);
    merged.push(match);
  }

  return merged;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;

  const tagName = target.tagName.toLocaleLowerCase();
  return target.isContentEditable || tagName === "input" || tagName === "textarea" || tagName === "select";
}

function createInputPreview(text: string): string {
  if (text.length <= TEXTAREA_PREVIEW_MAX_CHARS) return text;

  const labels = getMessages();
  return [
    text.slice(0, TEXTAREA_PREVIEW_MAX_CHARS),
    "",
    labels.previewTruncated(text.length.toLocaleString())
  ].join("\n");
}

function getSourceSizeLabel(text: string, exactSize: boolean): string {
  if (!exactSize || text.length > LARGE_SOURCE_CHARS) {
    return `${text.length.toLocaleString()} chars`;
  }

  return formatBytes(new Blob([text]).size);
}
