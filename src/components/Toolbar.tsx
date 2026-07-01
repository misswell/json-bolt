import type { Messages } from "../core/i18n";

interface ToolbarProps {
  labels: Messages;
  canParse: boolean;
  isParsing: boolean;
  expandLevel: number;
  onExpandLevelChange: (level: number) => void;
  onParse: () => void;
  onPasteReplace: () => void;
  onReadPage: () => void;
  onFormat: () => void;
  onMinify: () => void;
  onCopy: () => void;
  onClear: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}

export function Toolbar({
  labels,
  canParse,
  isParsing,
  onParse,
  onPasteReplace,
  onReadPage,
  onFormat,
  onMinify,
  onCopy,
  onClear,
  onExpandAll,
  expandLevel,
  onExpandLevelChange,
  onCollapseAll
}: ToolbarProps) {
  return (
    <div className="toolbar" role="toolbar" aria-label={labels.toolbarLabel}>
      <button type="button" onClick={onParse} disabled={!canParse || isParsing} title={labels.parseTitle}>
        {labels.parse}
      </button>
      <button type="button" onClick={onPasteReplace} disabled={isParsing} title={labels.pasteReplaceTitle}>
        {labels.pasteReplace}
      </button>
      <button type="button" onClick={onReadPage} disabled={isParsing} title={labels.pageTitle}>
        {labels.page}
      </button>
      <button type="button" onClick={onFormat} disabled={!canParse} title={labels.formatTitle}>
        {labels.format}
      </button>
      <button type="button" onClick={onMinify} disabled={!canParse} title={labels.minifyTitle}>
        {labels.minify}
      </button>
      <button type="button" onClick={onCopy} disabled={!canParse} title={labels.copyTitle}>
        {labels.copy}
      </button>
      <button type="button" onClick={onExpandAll} disabled={isParsing} title={labels.expandTitle}>
        {labels.expand}
      </button>
      <label className="level-control" title={labels.expandLevelTitle}>
        <span>{labels.expandLevel}</span>
        <input
          type="number"
          min={1}
          max={99}
          value={expandLevel}
          onChange={(event) => onExpandLevelChange(Number(event.target.value))}
          aria-label={labels.expandLevelLabel}
        />
      </label>
      <button type="button" onClick={onCollapseAll} disabled={isParsing} title={labels.collapseTitle}>
        {labels.collapse}
      </button>
      <button type="button" onClick={onClear} disabled={isParsing} title={labels.clearTitle}>
        {labels.clear}
      </button>
    </div>
  );
}
