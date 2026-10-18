/** Size in kB with one decimal below 10 kB (e.g. 0.4, 12). */
export function formatKb(bytes: number): string {
  const kb = bytes / 1024;
  return kb < 10 ? (Math.round(kb * 10) / 10).toString() : Math.round(kb).toString();
}
