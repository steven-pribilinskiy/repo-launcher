/** Human "time ago" from a Unix-seconds timestamp. */
export function timeAgo(unixSeconds: number): string {
  if (!unixSeconds) return "unknown";
  const diff = Math.max(0, Date.now() / 1000 - unixSeconds);
  const units: [string, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [name, secs] of units) {
    const count = Math.floor(diff / secs);
    if (count >= 1) return `${count} ${name}${count > 1 ? "s" : ""} ago`;
  }
  return "just now";
}
