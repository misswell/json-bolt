const EXPAND_LEVEL_KEY = "expandLevel";

export const DEFAULT_EXPAND_LEVEL = 2;

export function normalizeExpandLevel(value: unknown): number {
  if (value === null || value === undefined || value === "") return DEFAULT_EXPAND_LEVEL;
  const level = typeof value === "number" ? value : Number(value);
  return Number.isFinite(level) ? Math.min(99, Math.max(1, Math.floor(level))) : DEFAULT_EXPAND_LEVEL;
}

export async function loadExpandLevel(): Promise<number> {
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    return normalizeExpandLevel(window.localStorage.getItem(EXPAND_LEVEL_KEY));
  }

  try {
    const stored = await chrome.storage.local.get(EXPAND_LEVEL_KEY);
    return normalizeExpandLevel(stored[EXPAND_LEVEL_KEY]);
  } catch {
    return DEFAULT_EXPAND_LEVEL;
  }
}

export async function saveExpandLevel(value: number): Promise<void> {
  const level = normalizeExpandLevel(value);
  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    window.localStorage.setItem(EXPAND_LEVEL_KEY, String(level));
    return;
  }

  try {
    await chrome.storage.local.set({ [EXPAND_LEVEL_KEY]: level });
  } catch {
    // A transient storage failure should not prevent the level control from working.
  }
}
