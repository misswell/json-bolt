export type Locale = "en" | "zh";

export interface Messages {
  toolbarLabel: string;
  parse: string;
  parseTitle: string;
  pasteReplace: string;
  pasteReplaceTitle: string;
  page: string;
  pageTitle: string;
  format: string;
  formatTitle: string;
  minify: string;
  minifyTitle: string;
  copy: string;
  copyTitle: string;
  copied: string;
  expand: string;
  expandTitle: string;
  expandLevel: string;
  expandLevelTitle: string;
  expandLevelLabel: string;
  collapse: string;
  collapseTitle: string;
  clear: string;
  clearTitle: string;
  searchPlaceholder: string;
  previous: string;
  previousTitle: string;
  next: string;
  nextTitle: string;
  shortcutsHint: string;
  jsonInputLabel: string;
  emptyState: string;
  collapseNode: string;
  expandNode: string;
  items: string;
  keys: string;
  parsingLarge: string;
  parseStages: Record<"reading" | "parsing" | "building" | "done", string>;
  parseProgress: (stage: string, percent: number) => string;
  largeInputDetected: string;
  largeInputPreview: string;
  formatPaused: string;
  pageCaptureUnavailable: string;
  noReadableJson: string;
  unableReadPage: string;
  clipboardEmpty: string;
  clipboardReadFailed: string;
  dropFileHint: string;
  fileLoaded: (name: string) => string;
  fileReadFailed: string;
  previewTruncated: (chars: string) => string;
  errorLocation: (line: number, column: number) => string;
  errorPosition: (position: number) => string;
}

const en: Messages = {
  toolbarLabel: "JSON tools",
  parse: "Parse",
  parseTitle: "Parse JSON",
  pasteReplace: "Paste",
  pasteReplaceTitle: "Paste from clipboard and replace current JSON",
  page: "Page",
  pageTitle: "Read JSON from page",
  format: "Format",
  formatTitle: "Format JSON",
  minify: "Minify",
  minifyTitle: "Minify JSON",
  copy: "Copy",
  copyTitle: "Copy JSON",
  copied: "Copied.",
  expand: "Expand",
  expandTitle: "Expand all nodes",
  expandLevel: "Level",
  expandLevelTitle: "Expand to depth level",
  expandLevelLabel: "Depth level",
  collapse: "Collapse",
  collapseTitle: "Collapse all nodes",
  clear: "Clear",
  clearTitle: "Clear editor",
  searchPlaceholder: "Search key or value",
  previous: "Prev",
  previousTitle: "Previous match",
  next: "Next",
  nextTitle: "Next match",
  shortcutsHint: "Shortcuts: Ctrl/Command+Enter parse, Ctrl/Command+F search, Ctrl/Command+Shift+F format, Escape clear status.",
  jsonInputLabel: "JSON input",
  emptyState: "Paste JSON and parse it to inspect the tree.",
  collapseNode: "Collapse node",
  expandNode: "Expand node",
  items: "items",
  keys: "keys",
  parsingLarge: "Parsing large JSON in the background.",
  parseStages: {
    reading: "Reading input",
    parsing: "Parsing JSON",
    building: "Building tree",
    done: "Done"
  },
  parseProgress: (stage, percent) => `${stage}... ${percent}%`,
  largeInputDetected: "Large input detected. Auto parsing in the background.",
  largeInputPreview: "Large input loaded as preview. Auto parsing will run in the background.",
  formatPaused: "Format and minify are paused for large input to keep the page responsive.",
  pageCaptureUnavailable: "Page capture is available only inside Chrome extension pages.",
  noReadableJson: "No readable JSON text found on the current page.",
  unableReadPage: "Unable to read the current page.",
  clipboardEmpty: "Clipboard does not contain text.",
  clipboardReadFailed: "Unable to read clipboard. Paste manually or grant clipboard permission.",
  dropFileHint: "Drop a JSON or text file to replace and parse it.",
  fileLoaded: (name) => `Loaded ${name}. Parsing in the background.`,
  fileReadFailed: "Unable to read the dropped file.",
  previewTruncated: (chars) => `... Preview truncated. Full source is loaded in memory (${chars} chars).`,
  errorLocation: (line, column) => ` (line ${line}, column ${column})`,
  errorPosition: (position) => ` (byte ${position})`
};

const zh: Messages = {
  toolbarLabel: "JSON 工具",
  parse: "解析",
  parseTitle: "解析 JSON",
  pasteReplace: "粘贴",
  pasteReplaceTitle: "从剪贴板粘贴并替换当前 JSON",
  page: "页面",
  pageTitle: "读取当前页面 JSON",
  format: "格式化",
  formatTitle: "格式化 JSON",
  minify: "压缩",
  minifyTitle: "压缩 JSON",
  copy: "复制",
  copyTitle: "复制 JSON",
  copied: "已复制。",
  expand: "展开",
  expandTitle: "展开全部节点",
  expandLevel: "层级",
  expandLevelTitle: "展开到指定层级",
  expandLevelLabel: "展开层级",
  collapse: "折叠",
  collapseTitle: "折叠全部节点",
  clear: "清空",
  clearTitle: "清空编辑器",
  searchPlaceholder: "搜索 key 或 value",
  previous: "上一个",
  previousTitle: "上一个匹配",
  next: "下一个",
  nextTitle: "下一个匹配",
  shortcutsHint: "快捷键：Ctrl/Command+Enter 解析，Ctrl/Command+F 搜索，Ctrl/Command+Shift+F 格式化，Escape 清除状态。",
  jsonInputLabel: "JSON 输入",
  emptyState: "粘贴 JSON 后即可查看树结构。",
  collapseNode: "折叠节点",
  expandNode: "展开节点",
  items: "项",
  keys: "个键",
  parsingLarge: "正在后台解析大型 JSON。",
  parseStages: {
    reading: "读取输入",
    parsing: "解析 JSON",
    building: "构建树结构",
    done: "完成"
  },
  parseProgress: (stage, percent) => `${stage}中... ${percent}%`,
  largeInputDetected: "检测到大文本，正在后台自动解析。",
  largeInputPreview: "大文本已作为预览载入，将在后台自动解析。",
  formatPaused: "为保持页面流畅，大文本暂不执行格式化/压缩。",
  pageCaptureUnavailable: "读取页面内容仅在 Chrome 扩展页面中可用。",
  noReadableJson: "当前页面没有可读取的 JSON 文本。",
  unableReadPage: "无法读取当前页面。",
  clipboardEmpty: "剪贴板中没有文本。",
  clipboardReadFailed: "无法读取剪贴板，请手动粘贴或授予剪贴板权限。",
  dropFileHint: "松开即可载入 JSON 或文本文件并自动解析。",
  fileLoaded: (name) => `已载入 ${name}，正在后台解析。`,
  fileReadFailed: "无法读取拖入的文件。",
  previewTruncated: (chars) => `... 预览已截断，完整内容已载入内存（${chars} 字符）。`,
  errorLocation: (line, column) => `（第 ${line} 行，第 ${column} 列）`,
  errorPosition: (position) => `（字节位置 ${position}）`
};

export function detectLocale(): Locale {
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLocaleLowerCase().startsWith("zh")) ? "zh" : "en";
}

export function getMessages(locale = detectLocale()): Messages {
  return locale === "zh" ? zh : en;
}
