const TZ_ABBR_MAP: Record<string, string> = {
  "America/New_York": "ET",
  "America/Chicago": "CT",
  "America/Denver": "MT",
  "America/Los_Angeles": "PT",
  "America/Anchorage": "AKT",
  "Pacific/Honolulu": "HT",
  "America/Phoenix": "MST",
  "UTC": "UTC",
};

export function getTzAbbr(tz: string): string {
  return TZ_ABBR_MAP[tz] || tz;
}

export function formatTimestamp(date: string | Date, tz: string, options?: Intl.DateTimeFormatOptions): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const defaults: Intl.DateTimeFormatOptions = {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...options,
  };
  return d.toLocaleString("en-US", defaults);
}

export function formatDateOnly(date: string | Date, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric" });
}

export function formatDateShort(date: string | Date, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "2-digit", day: "2-digit", year: "2-digit" }).format(d);
  return parts;
}

export function formatSessionTimeMobile(
  firstPhotoAt: string | Date | null,
  lastPhotoAt: string | Date | null,
  tz: string,
): string {
  if (!firstPhotoAt) return "No photos yet";
  const dateStr = formatDateShort(firstPhotoAt, tz);
  if (!lastPhotoAt || new Date(firstPhotoAt).getTime() === new Date(lastPhotoAt).getTime()) {
    return `${dateStr} · 0s`;
  }
  const diff = new Date(lastPhotoAt).getTime() - new Date(firstPhotoAt).getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${seconds}s`;
  return `${dateStr} · ${elapsed}`;
}

export function formatTimeOnly(date: string | Date, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", { timeZone: tz, hour: "2-digit", minute: "2-digit" });
}

export function formatFullTimestamp(date: string | Date, tz: string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const str = d.toLocaleString("en-US", {
    timeZone: tz,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  return `${str} ${getTzAbbr(tz)}`;
}

export function formatSessionTimeWithTz(
  firstPhotoAt: string | Date | null,
  lastPhotoAt: string | Date | null,
  tz: string,
  elapsedOnly = false,
): string {
  if (!firstPhotoAt) return "No photos yet";
  const fmt = (d: string | Date) => formatTimestamp(d, tz);
  const timeFmt = (d: string | Date) => formatTimeOnly(d, tz);
  const dateFmt = (d: string | Date) => formatDateOnly(d, tz);

  if (!lastPhotoAt || new Date(firstPhotoAt).getTime() === new Date(lastPhotoAt).getTime()) {
    return elapsedOnly ? "0s" : fmt(firstPhotoAt);
  }
  const start = new Date(firstPhotoAt);
  const end = new Date(lastPhotoAt);
  const diff = end.getTime() - start.getTime();
  const hours = Math.floor(diff / 3600000);
  const minutes = Math.floor((diff % 3600000) / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  const elapsed = hours > 0 ? `${hours}h ${minutes}m` : minutes > 0 ? `${minutes}m` : `${seconds}s`;
  if (elapsedOnly) return elapsed;

  const sameDay = (() => {
    const sd = new Date(start.toLocaleString("en-US", { timeZone: tz }));
    const ed = new Date(end.toLocaleString("en-US", { timeZone: tz }));
    return sd.getFullYear() === ed.getFullYear() && sd.getMonth() === ed.getMonth() && sd.getDate() === ed.getDate();
  })();

  if (sameDay) {
    const startTime = timeFmt(firstPhotoAt);
    const endTime = timeFmt(lastPhotoAt);
    const startParts = startTime.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
    const endParts = endTime.match(/^(\d+):(\d+)\s*(AM|PM)?$/i);
    if (startParts && endParts && startParts[1] === endParts[1] && startParts[3] === endParts[3]) {
      const suffix = startParts[3] ? ` ${startParts[3]}` : "";
      return `${dateFmt(firstPhotoAt)}, ${startParts[1]}:${startParts[2]}-${endParts[2]}${suffix} (${elapsed})`;
    }
    return `${dateFmt(firstPhotoAt)}, ${startTime}-${endTime} (${elapsed})`;
  }
  return `${fmt(firstPhotoAt)} - ${fmt(lastPhotoAt)} (${elapsed})`;
}
