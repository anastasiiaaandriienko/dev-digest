/** Size in kB with one decimal below 10 kB (e.g. 0.4, 12). */
export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 10 ? (Math.round(kb * 10) / 10).toString() : Math.round(kb).toString();
}

/** Last path segment: the name shown in the preview header and given to a download. */
export function fileName(path: string): string {
  const parts = path.split("/");
  return parts[parts.length - 1] || path;
}

/** Sum of the listed docs' sizes in bytes. */
export function totalSize(files: { size: number }[]): number {
  return files.reduce((sum, f) => sum + f.size, 0);
}

/** Save `content` as a local Markdown file (client only; no request is made). */
export function downloadMarkdown(name: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: "text/markdown;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
