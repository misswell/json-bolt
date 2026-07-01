import type { RefObject } from "react";
import type { Messages } from "../core/i18n";

interface SearchBoxProps {
  labels: Messages;
  inputRef?: RefObject<HTMLInputElement>;
  value: string;
  currentIndex: number;
  matchCount: number;
  onChange: (value: string) => void;
  onPrevious: () => void;
  onNext: () => void;
}

export function SearchBox({
  labels,
  inputRef,
  value,
  currentIndex,
  matchCount,
  onChange,
  onPrevious,
  onNext
}: SearchBoxProps) {
  const label = matchCount > 0 ? `${currentIndex + 1} / ${matchCount}` : "0 / 0";

  return (
    <div className="search-box">
      <input
        ref={inputRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={labels.searchPlaceholder}
        aria-label={labels.searchPlaceholder}
      />
      <span>{label}</span>
      <button type="button" onClick={onPrevious} disabled={matchCount === 0} title={labels.previousTitle}>
        {labels.previous}
      </button>
      <button type="button" onClick={onNext} disabled={matchCount === 0} title={labels.nextTitle}>
        {labels.next}
      </button>
    </div>
  );
}
