/** 1536 → "1.5 KB". Two significant decimals at most. */
export function formatBytes(bytes: number): string {
  if (!isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = value >= 100 || unit === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

export function formatSpeed(bytesPerSecond: number): string {
  if (bytesPerSecond < 1) return "—";
  return `${formatBytes(bytesPerSecond)}/s`;
}

/** Seconds left, as "1m 20s". */
export function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${Math.floor(seconds % 60)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

export function percentOf(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, (received / total) * 100));
}

export function formatPercent(received: number, total: number): string {
  if (total <= 0) return "—";
  const value = percentOf(received, total);
  return value >= 9.95 ? `${value.toFixed(0)}%` : `${value.toFixed(1)}%`;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** "3 分钟前". */
export function timeAgo(at: number): string {
  const delta = Math.max(0, Date.now() - at) / 1000;
  if (delta < 45) return "刚刚";
  if (delta < 3600) return `${Math.round(delta / 60)} 分钟前`;
  if (delta < 86400) return `${Math.round(delta / 3600)} 小时前`;
  return `${Math.round(delta / 86400)} 天前`;
}
