import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, formatJson, minifyJson } from "../core/formatter";
import { getMessages } from "../core/i18n";
import { DEFAULT_EXPAND_LEVEL, loadExpandLevel, normalizeExpandLevel, saveExpandLevel } from "../core/preferences";
import { buildVisibleNodes } from "../core/tree";
import { searchNodes } from "../core/search";
import type { JsonNode, ParserResponse, SearchMatch } from "../core/types";
import { JsonViewer } from "./JsonViewer";
import { SearchBox } from "./SearchBox";
import { Toolbar } from "./Toolbar";

const INITIAL_SOURCE = "";
const TEXTAREA_PREVIEW_MAX_CHARS = 200_000;
const LARGE_SOURCE_CHARS = 1_000_000;
const AUTO_PARSE_DELAY_MS = 650;
const MAX_CONCURRENT_EXPANSION_REQUESTS = 1;
const MIN_EXPANSION_PROGRESS_MS = 450;
const EXPANSION_NOTICE_DELAY_MS = 200;
const MAX_UTF16_NODE_COPY_CHARS = 16 * 1024 * 1024;
const MAX_SOURCE_HISTORY_ENTRIES = 10;
const LARGE_SOURCE_HISTORY_ENTRIES = 1;

interface AppProps {
  surface: "page" | "sidepanel";
}

type ExpansionTarget = number | "all" | null;
type SourceReplacement = { before: string; after: string };

export function App({ surface }: AppProps) {
  const labels = useMemo(() => getMessages(), []);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const sourceTextRef = useRef(INITIAL_SOURCE);
  const sourceBlobRef = useRef<Blob | null>(null);
  const autoParseTimerRef = useRef<number | null>(null);
  const latestRequestIdRef = useRef(0);
  const debouncedQueryRef = useRef("");
  const pendingSearchRevealRef = useRef<{ query: string; index: number } | null>(null);
  const expansionNoticeActiveRef = useRef(false);
  const expansionProgressSuppressedRef = useRef(false);
  const expansionProgressStartedAtRef = useRef(0);
  const expansionProgressHideTimerRef = useRef<number | null>(null);
  const expansionNoticeShowTimerRef = useRef<number | null>(null);
  const expansionRunIdRef = useRef(0);
  const nextExpansionRequestIdRef = useRef(0);
  const nextValueRequestIdRef = useRef(0);
  const activeValueRequestIdRef = useRef<number | null>(null);
  const expansionRequestsRef = useRef<Map<number, { runId: number; requestId: number }>>(new Map());
  const expandingNodeIdsRef = useRef<Set<number>>(new Set());
  const dragDepthRef = useRef(0);
  const sourceTabIdRef = useRef(surface === "page" ? getSourceTabId() : undefined);
  const expandLevelSelectedRef = useRef(false);
  const expandLevelRef = useRef(DEFAULT_EXPAND_LEVEL);
  const nodeIndexByIdRef = useRef<Map<number, number>>(new Map());
  const nodeIdByIdentityRef = useRef<Map<string, number>>(new Map());
  const sourceUndoStackRef = useRef<SourceReplacement[]>([]);
  const sourceRedoStackRef = useRef<SourceReplacement[]>([]);
  const [sourceInfo, setSourceInfo] = useState({
    hasText: INITIAL_SOURCE.length > 0,
    sizeLabel: formatBytes(new Blob([INITIAL_SOURCE]).size)
  });
  const [isPreviewMode, setIsPreviewMode] = useState(false);
  const [nodes, setNodes] = useState<JsonNode[]>([]);
  const [rootIds, setRootIds] = useState<number[]>([]);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [isParsing, setIsParsing] = useState(false);
  const [isExpanding, setIsExpanding] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [workerMatches, setWorkerMatches] = useState<SearchMatch[]>([]);
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [searchScrollTargetId, setSearchScrollTargetId] = useState<number | null>(null);
  const [searchScrollSignal, setSearchScrollSignal] = useState(0);
  const [visibleRange, setVisibleRange] = useState({ start: 0, stop: 0 });
  const [expandLevel, setExpandLevel] = useState(DEFAULT_EXPAND_LEVEL);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const [pendingExpandLevel, setPendingExpandLevel] = useState<ExpansionTarget>(null);
  const [copyingNodeId, setCopyingNodeId] = useState<number | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL("../worker/jsonParser.worker.ts", import.meta.url), {
      type: "module"
    });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<ParserResponse>) => {
      const response = event.data;
      if (response.requestId !== latestRequestIdRef.current) return;

      if (response.type === "value") {
        if (activeValueRequestIdRef.current !== response.valueRequestId) return;
        activeValueRequestIdRef.current = null;
        setCopyingNodeId(null);
        if (response.error || response.text === undefined) {
          setError(response.error ?? labels.clipboardWriteFailed);
          return;
        }
        void navigator.clipboard.writeText(response.text).then(
          () => {
            setError(null);
            setNotice(labels.copied);
          },
          () => setError(labels.clipboardWriteFailed)
        );
        return;
      }

      if (response.type === "progress") {
        if (
          expansionProgressSuppressedRef.current ||
          (expandingNodeIdsRef.current.size > 0 && debouncedQueryRef.current.trim())
        ) {
          return;
        }
        setProgress(response.total === 0 ? 0 : response.parsed / response.total);
        const stage = labels.parseStages[response.stage];
        const percent = Math.max(0, Math.min(100, Math.round((response.parsed / response.total) * 100)));
        setNotice(labels.parseProgress(stage, percent));
        return;
      }

      if (response.type === "error") {
        resetExpansionTracking();
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
        replaceNodes([]);
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
        const requestInfo = expansionRequestsRef.current.get(response.nodeId);
        if (
          !requestInfo ||
          requestInfo.runId !== expansionRunIdRef.current ||
          requestInfo.requestId !== response.expandRequestId
        ) {
          return;
        }
        expansionRequestsRef.current.delete(response.nodeId);
        expandingNodeIdsRef.current.delete(response.nodeId);
        clearExpansionNoticeShowTimer();
        setNodes((current) => {
          const childIds = response.children.map(
            (child) => nodeIdByIdentityRef.current.get(getNodeIdentity(child)) ?? child.id
          );
          const next = current.slice();
          const parentIndex = nodeIndexByIdRef.current.get(response.nodeId);
          if (parentIndex !== undefined) {
            next[parentIndex] = { ...next[parentIndex], children: childIds };
          }
          for (const child of response.children) {
            const identity = getNodeIdentity(child);
            if (nodeIdByIdentityRef.current.has(identity)) continue;
            nodeIndexByIdRef.current.set(child.id, next.length);
            nodeIdByIdentityRef.current.set(identity, child.id);
            next.push(child);
          }
          return next;
        });
        setExpandedIds((current) => new Set(current).add(response.nodeId));
        setProgress(0);
        if (expansionNoticeActiveRef.current && expandingNodeIdsRef.current.size === 0) {
          expansionNoticeActiveRef.current = false;
          setNotice(null);
        }
        return;
      }

      setIsParsing(false);
      setError(null);
      setNotice(null);
      resetExpansionTracking();
      replaceNodes(response.nodes);
      setRootIds(response.rootIds);
      setExpandedIds(
        new Set(
          response.rootIds.filter((rootId) => response.nodes.some((node) => node.id === rootId && node.children !== undefined))
        )
      );
      setWorkerMatches([]);
      setProgress(0);
      setActiveMatchIndex(0);
      if (response.nodes.some((node) => node.childCount > 0)) {
        startExpansionRun();
        setPendingExpandLevel(expandLevelRef.current);
      }
    };

    return () => {
      if (autoParseTimerRef.current !== null) {
        window.clearTimeout(autoParseTimerRef.current);
      }
      clearExpansionProgressHideTimer();
      clearExpansionNoticeShowTimer();
      worker.terminate();
    };
  }, [labels]);

  useEffect(() => {
    window.setTimeout(() => parseCurrentSource(), 0);
  }, []);

  useEffect(() => {
    let active = true;
    void loadExpandLevel().then((level) => {
      if (active && !expandLevelSelectedRef.current) {
        expandLevelRef.current = level;
        setExpandLevel(level);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      const modifier = event.metaKey || event.ctrlKey;
      const isSourceEditor = event.target === inputRef.current;
      const key = event.key.toLocaleLowerCase();
      if (modifier && isSourceEditor && key === "z") {
        const handled = event.shiftKey ? redoSourceReplacement() : undoSourceReplacement();
        if (handled) event.preventDefault();
        return;
      }

      if (modifier && isSourceEditor && key === "y") {
        if (redoSourceReplacement()) event.preventDefault();
        return;
      }

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
  const expandableNodeCount = useMemo(
    () => nodes.reduce((count, node) => count + (node.childCount > 0 ? 1 : 0), 0),
    [nodes]
  );
  const expandedExpandableNodeCount = useMemo(
    () => nodes.reduce((count, node) => count + (node.childCount > 0 && expandedIds.has(node.id) ? 1 : 0), 0),
    [expandedIds, nodes]
  );
  const expandedNodePercent =
    expandableNodeCount === 0 ? 100 : Math.round((expandedExpandableNodeCount / expandableNodeCount) * 100);

  useEffect(() => {
    debouncedQueryRef.current = debouncedQuery;
    setWorkerMatches([]);
    if (debouncedQuery.trim()) {
      cancelExpansionWork();
      pendingSearchRevealRef.current = { query: debouncedQuery, index: 0 };
      setPendingExpandLevel(null);
    } else {
      pendingSearchRevealRef.current = null;
      setSearchScrollTargetId(null);
    }

    if (!workerRef.current) return;

    workerRef.current.postMessage({
      type: "search",
      requestId: latestRequestIdRef.current,
      query: debouncedQuery,
      limit: 500
    });
  }, [debouncedQuery]);

  useEffect(() => {
    if (!debouncedQuery.trim() || !workerRef.current) return;

    workerRef.current.postMessage({
      type: "search",
      requestId: latestRequestIdRef.current,
      query: debouncedQuery,
      limit: 500
    });
  }, [nodes.length]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [debouncedQuery]);

  useEffect(() => {
    if (matches.length === 0) {
      setSearchScrollTargetId(null);
      if (!debouncedQuery.trim()) {
        pendingSearchRevealRef.current = null;
      }
      return;
    }

    const nextIndex = Math.min(activeMatchIndex, matches.length - 1);
    if (nextIndex !== activeMatchIndex) {
      setActiveMatchIndex(nextIndex);
      return;
    }

    const targetId = matches[nextIndex]?.nodeId;
    if (targetId === undefined) return;

    const pendingReveal = pendingSearchRevealRef.current;
    if (!pendingReveal || pendingReveal.query !== debouncedQuery || pendingReveal.index !== nextIndex) return;

    pendingSearchRevealRef.current = null;
    revealNode(targetId);
    setSearchScrollTargetId(targetId);
    setSearchScrollSignal((current) => current + 1);
  }, [activeMatchIndex, debouncedQuery, matches, nodesById]);

  useEffect(() => {
    if (pendingExpandLevel === null) return;

    const changed = expandLoadedNodesToLevel(pendingExpandLevel);
    const requested = requestUnloadedNodesToLevel(pendingExpandLevel, expansionRunIdRef.current);

    if (!changed && !requested && expandingNodeIdsRef.current.size === 0) {
      setPendingExpandLevel(null);
      finishExpansionRun();
    }
  }, [nodes, pendingExpandLevel]);

  useEffect(() => {
    if (!isExpanding || pendingExpandLevel !== null || expandingNodeIdsRef.current.size > 0) return;
    if (expandedNodePercent === 100) {
      finishExpansionRun();
    }
  }, [expandedNodePercent, isExpanding, pendingExpandLevel]);

  function getSource() {
    return sourceTextRef.current;
  }

  function replaceNodes(nextNodes: JsonNode[]) {
    nodeIndexByIdRef.current = new Map(nextNodes.map((node, index) => [node.id, index]));
    nodeIdByIdentityRef.current = new Map(nextNodes.map((node) => [getNodeIdentity(node), node.id]));
    setNodes(nextNodes);
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
    cancelNodeCopy();
    replaceNodes([]);
    setRootIds([]);
    setExpandedIds(new Set());
    resetExpansionTracking();
    setPendingExpandLevel(null);
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
    cancelNodeCopy();
    replaceNodes([]);
    setRootIds([]);
    setExpandedIds(new Set());
    resetExpansionTracking();
    setPendingExpandLevel(null);
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
      if (sourceBlobRef.current) {
        setNotice(labels.formatPaused);
        return;
      }
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
    try {
      const blob = sourceBlobRef.current;
      if (blob && navigator.clipboard.write && typeof ClipboardItem !== "undefined") {
        try {
          const clipboardBlob = blob.slice(0, blob.size, "text/plain");
          await navigator.clipboard.write([new ClipboardItem({ "text/plain": clipboardBlob })]);
        } catch {
          await navigator.clipboard.writeText(await blob.text());
        }
      } else {
        await navigator.clipboard.writeText(blob ? await blob.text() : getSource());
      }
      setNotice(labels.copied);
    } catch (copyError) {
      setError(copyError instanceof Error ? copyError.message : labels.clipboardWriteFailed);
    }
  };

  const copyNodeValue = async (id: number) => {
    if (copyingNodeId !== null) return;
    const node = nodesById.get(id);
    if (node?.valueStart === undefined || node.valueEnd === undefined || !workerRef.current) return;

    setCopyingNodeId(id);
    setError(null);
    const sourceBlob = sourceBlobRef.current;
    try {
      if (sourceBlob && node.offsetUnit === "byte") {
        if (!navigator.clipboard.write || typeof ClipboardItem === "undefined") {
          throw new Error(labels.clipboardWriteFailed);
        }
        const valueBlob = sourceBlob.slice(node.valueStart, node.valueEnd, "text/plain");
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": valueBlob })]);
        setCopyingNodeId(null);
        setNotice(labels.copied);
        return;
      }

      if (!sourceBlob) {
        await navigator.clipboard.writeText(sourceTextRef.current.slice(node.valueStart, node.valueEnd));
        setCopyingNodeId(null);
        setNotice(labels.copied);
        return;
      }

      if (node.valueEnd - node.valueStart > MAX_UTF16_NODE_COPY_CHARS) {
        setCopyingNodeId(null);
        setError(labels.copyValueTooLarge);
        return;
      }
    } catch {
      setCopyingNodeId(null);
      setError(labels.clipboardWriteFailed);
      return;
    }

    const valueRequestId = nextValueRequestIdRef.current + 1;
    nextValueRequestIdRef.current = valueRequestId;
    activeValueRequestIdRef.current = valueRequestId;
    workerRef.current.postMessage({
      type: "readValue",
      requestId: latestRequestIdRef.current,
      valueRequestId,
      nodeId: node.id
    });
  };

  function cancelNodeCopy() {
    activeValueRequestIdRef.current = null;
    setCopyingNodeId(null);
  }

  function recordSourceReplacement(after: string) {
    if (sourceBlobRef.current) {
      clearSourceHistory();
      return;
    }
    const before = getSource();
    if (before === after) return;
    sourceUndoStackRef.current.push({ before, after });
    const historyLimit =
      before.length + after.length > LARGE_SOURCE_CHARS ? LARGE_SOURCE_HISTORY_ENTRIES : MAX_SOURCE_HISTORY_ENTRIES;
    while (sourceUndoStackRef.current.length > historyLimit) {
      sourceUndoStackRef.current.shift();
    }
    sourceRedoStackRef.current = [];
  }

  function undoSourceReplacement(): boolean {
    const replacement = sourceUndoStackRef.current[sourceUndoStackRef.current.length - 1];
    if (!replacement || getSource() !== replacement.after) return false;
    sourceUndoStackRef.current.pop();
    sourceRedoStackRef.current.push(replacement);
    restoreSourceFromHistory(replacement.before);
    return true;
  }

  function redoSourceReplacement(): boolean {
    const replacement = sourceRedoStackRef.current[sourceRedoStackRef.current.length - 1];
    if (!replacement || getSource() !== replacement.before) return false;
    sourceRedoStackRef.current.pop();
    sourceUndoStackRef.current.push(replacement);
    restoreSourceFromHistory(replacement.after);
    return true;
  }

  function restoreSourceFromHistory(text: string) {
    cancelAutoParse();
    setSourceText(text);
    setError(null);
    setNotice(null);
    if (text) {
      window.setTimeout(() => parseSource(text), 0);
      return;
    }
    latestRequestIdRef.current += 1;
    setIsParsing(false);
    setProgress(0);
    replaceNodes([]);
    setRootIds([]);
    setExpandedIds(new Set());
    setWorkerMatches([]);
    cancelExpansionWork();
  }

  function clearSourceHistory() {
    sourceUndoStackRef.current = [];
    sourceRedoStackRef.current = [];
  }

  function replaceSourceAndParse(text: string, nextNotice?: string | null) {
    cancelAutoParse();
    recordSourceReplacement(text);
    setSourceText(text);
    inputRef.current?.focus();
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
      clearSourceHistory();
      setSourceFile(file, preview);
      replaceNodes([]);
      setRootIds([]);
      setExpandedIds(new Set());
      setWorkerMatches([]);
      resetExpansionTracking();

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

    let tabId = sourceTabId ?? sourceTabIdRef.current;
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

    if (expandedIds.has(id)) {
      setExpandedIds((current) => {
        if (!current.has(id)) return current;
        const next = new Set(current);
        next.delete(id);
        return next;
      });
      return;
    }

    if (requestNodeExpansion(node, expansionRunIdRef.current)) {
      scheduleExpansionNotice();
      return;
    }

    setExpandedIds((current) => {
      if (current.has(id)) return current;
      const next = new Set(current);
      next.add(id);
      return next;
    });
  };

  const requestNodeExpansion = (node: JsonNode, runId = expansionRunIdRef.current): boolean => {
    if (node.childCount <= 0 || node.children || node.valueStart === undefined || !workerRef.current) {
      return false;
    }
    if (expandingNodeIdsRef.current.has(node.id)) {
      return false;
    }

    expandingNodeIdsRef.current.add(node.id);
    const expandRequestId = nextExpansionRequestIdRef.current + 1;
    nextExpansionRequestIdRef.current = expandRequestId;
    expansionRequestsRef.current.set(node.id, { runId, requestId: expandRequestId });
    workerRef.current.postMessage({
      type: "expand",
      requestId: latestRequestIdRef.current,
      expandRequestId,
      nodeId: node.id,
      valueStart: node.valueStart,
      depth: node.depth
    });
    return true;
  };

  const expandAll = () => {
    const runId = startExpansionRun();
    setPendingExpandLevel("all");
    expandLoadedNodesToLevel("all");
    requestUnloadedNodesToLevel("all", runId);
  };

  const expandToLevel = (level: number) => {
    const normalized = normalizeExpandLevel(level);
    expandLevelRef.current = normalized;
    const runId = startExpansionRun();
    setExpandLevel(normalized);
    setPendingExpandLevel(normalized);
    expandLoadedNodesToLevel(normalized);
    requestUnloadedNodesToLevel(normalized, runId);
  };

  const selectExpandLevel = (level: number) => {
    const normalized = normalizeExpandLevel(level);
    expandLevelSelectedRef.current = true;
    expandToLevel(normalized);
    void saveExpandLevel(normalized);
  };

  const expandLoadedNodesToLevel = (level: Exclude<ExpansionTarget, null>): boolean => {
    let changed = false;
    setExpandedIds((current) => {
      const next = new Set(current);
      for (const node of nodes) {
        if (node.childCount > 0 && shouldExpandNode(node, level) && node.children && !next.has(node.id)) {
          next.add(node.id);
          changed = true;
        }
      }
      return changed ? next : current;
    });
    return changed;
  };

  const requestUnloadedNodesToLevel = (
    level: Exclude<ExpansionTarget, null>,
    runId = expansionRunIdRef.current
  ): boolean => {
    let requested = false;
    let availableSlots = Math.max(0, MAX_CONCURRENT_EXPANSION_REQUESTS - expandingNodeIdsRef.current.size);
    if (availableSlots === 0) return false;

    for (const node of nodes) {
      if (availableSlots === 0) break;
      if (shouldExpandNode(node, level) && requestNodeExpansion(node, runId)) {
        requested = true;
        availableSlots -= 1;
      }
    }
    if (requested) {
      showExpansionNotice();
    }
    return requested;
  };

  const showExpansionNotice = () => {
    if (debouncedQueryRef.current.trim()) return;

    expansionNoticeActiveRef.current = true;
    expansionProgressSuppressedRef.current = false;
    setNotice(labels.parseProgress(labels.parseStages.building, 0));
  };

  const scheduleExpansionNotice = () => {
    clearExpansionNoticeShowTimer();
    expansionNoticeShowTimerRef.current = window.setTimeout(() => {
      expansionNoticeShowTimerRef.current = null;
      showExpansionNotice();
    }, EXPANSION_NOTICE_DELAY_MS);
  };

  const clearExpansionNoticeShowTimer = () => {
    if (expansionNoticeShowTimerRef.current === null) return;
    window.clearTimeout(expansionNoticeShowTimerRef.current);
    expansionNoticeShowTimerRef.current = null;
  };

  const startExpansionRun = (): number => {
    expansionRunIdRef.current += 1;
    expansionRequestsRef.current.clear();
    expandingNodeIdsRef.current.clear();
    expansionNoticeActiveRef.current = false;
    expansionProgressSuppressedRef.current = false;
    expansionProgressStartedAtRef.current = performance.now();
    clearExpansionProgressHideTimer();
    setIsExpanding(true);
    return expansionRunIdRef.current;
  };

  const finishExpansionRun = () => {
    const elapsed = performance.now() - expansionProgressStartedAtRef.current;
    const remaining = Math.max(0, MIN_EXPANSION_PROGRESS_MS - elapsed);
    clearExpansionProgressHideTimer();

    if (remaining === 0) {
      setIsExpanding(false);
      return;
    }

    expansionProgressHideTimerRef.current = window.setTimeout(() => {
      expansionProgressHideTimerRef.current = null;
      setIsExpanding(false);
    }, remaining);
  };

  const clearExpansionProgressHideTimer = () => {
    if (expansionProgressHideTimerRef.current === null) return;

    window.clearTimeout(expansionProgressHideTimerRef.current);
    expansionProgressHideTimerRef.current = null;
  };

  const resetExpansionTracking = () => {
    expansionRunIdRef.current += 1;
    expansionRequestsRef.current.clear();
    expandingNodeIdsRef.current.clear();
    expansionNoticeActiveRef.current = false;
    expansionProgressSuppressedRef.current = false;
    clearExpansionProgressHideTimer();
    clearExpansionNoticeShowTimer();
    setIsExpanding(false);
  };

  const cancelExpansionWork = () => {
    expansionRunIdRef.current += 1;
    expansionRequestsRef.current.clear();
    expandingNodeIdsRef.current.clear();
    expansionNoticeActiveRef.current = false;
    expansionProgressSuppressedRef.current = true;
    clearExpansionProgressHideTimer();
    clearExpansionNoticeShowTimer();
    setIsExpanding(false);
    setPendingExpandLevel(null);
    setProgress(0);
    setNotice(null);
  };

  const collapseAll = () => {
    cancelExpansionWork();
    setExpandedIds(new Set(rootIds));
  };

  const goToMatch = (direction: 1 | -1) => {
    if (matches.length === 0) return;
    setActiveMatchIndex((current) => {
      const next = (current + direction + matches.length) % matches.length;
      const targetId = matches[next]?.nodeId;
      if (targetId !== undefined) {
        revealNode(targetId);
        setSearchScrollTargetId(targetId);
        setSearchScrollSignal((signal) => signal + 1);
      }
      return next;
    });
  };

  const revealNode = (id: number) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      let changed = false;
      let node = nodesById.get(id);

      while (node?.parentId !== null && node?.parentId !== undefined) {
        if (!next.has(node.parentId)) {
          next.add(node.parentId);
          changed = true;
        }
        node = nodesById.get(node.parentId);
      }

      return changed ? next : current;
    });
  };

  const stats = `${nodes.length.toLocaleString()} nodes | expanded ${expandedExpandableNodeCount.toLocaleString()}/${expandableNodeCount.toLocaleString()} (${expandedNodePercent}%) | ${sourceInfo.sizeLabel} | visible ${visibleRange.start + 1}-${Math.min(visibleRange.stop + 1, visibleNodes.length)} of ${visibleNodes.length.toLocaleString()}`;
  const headerProgress = isParsing ? progress : expandedNodePercent / 100;

  return (
    <main className={`app app-${surface}`}>
      <header className="app-header">
        <div>
          <h1>JsonBolt</h1>
          <p>{stats}</p>
        </div>
        <p className="shortcut-hint">{labels.shortcutsHint}</p>
        {(isParsing || isExpanding) && (
          <div className="progress" aria-label={isParsing ? "Parse progress" : "Expand progress"}>
            <span style={{ width: `${Math.round(headerProgress * 100)}%` }} />
          </div>
        )}
      </header>

      <Toolbar
        labels={labels}
        canParse={sourceInfo.hasText}
        isParsing={isParsing}
        expandLevel={expandLevel}
        onExpandLevelChange={selectExpandLevel}
        onParse={parseCurrentSource}
        onPasteReplace={pasteReplace}
        onReadPage={() => readCurrentPage(undefined, true)}
        onFormat={() => updateSourceSafely(formatJson)}
        onMinify={() => updateSourceSafely(minifyJson)}
        onCopy={copySource}
        onClear={() => {
          cancelAutoParse();
          sourceBlobRef.current = null;
          clearSourceHistory();
          setSourceText("");
          replaceNodes([]);
          cancelNodeCopy();
          setRootIds([]);
          setExpandedIds(new Set());
          setWorkerMatches([]);
          cancelExpansionWork();
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
            sourceRedoStackRef.current = [];
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
            searchScrollTargetId={searchScrollTargetId}
            searchScrollSignal={searchScrollSignal}
            onToggle={toggleNode}
            onCopy={copyNodeValue}
            copyingNodeId={copyingNodeId}
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

function getNodeIdentity(node: JsonNode): string {
  return `${node.parentId ?? "root"}\u0000${node.key ?? ""}\u0000${node.valueStart ?? node.id}`;
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

function shouldExpandNode(node: JsonNode, target: Exclude<ExpansionTarget, null>): boolean {
  return target === "all" || node.depth < target;
}

function getSourceTabId(): number | undefined {
  const value = new URLSearchParams(window.location.search).get("sourceTabId");
  if (!value) return undefined;
  const tabId = Number(value);
  return Number.isInteger(tabId) && tabId > 0 ? tabId : undefined;
}
