export function formatJson(text: string): string {
  return JSON.stringify(JSON.parse(text), null, 2);
}

export function minifyJson(text: string): string {
  return JSON.stringify(JSON.parse(text));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function getJsonErrorPosition(error: unknown): number | undefined {
  if (!(error instanceof SyntaxError)) return undefined;
  const match = /position (\d+)/i.exec(error.message);
  return match ? Number(match[1]) : undefined;
}

export function getLineColumn(text: string, position: number): { line: number; column: number } {
  let line = 1;
  let column = 1;

  for (let index = 0; index < position && index < text.length; index += 1) {
    if (text[index] === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}
