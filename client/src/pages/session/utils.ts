import { WIRE_TYPES as REF_WIRE_TYPES, WIRE_GAUGES, WIRE_COLORS } from "@/lib/wireReference";

export const WIRE_TYPES = [...REF_WIRE_TYPES];
export const GAUGES = [...WIRE_GAUGES];
export const POSITIONS = ["On Floor", "In Front Of", "900", "800", "700", "600", "500", "400", "__none__"];
export const COLOR_OPTIONS = [
  { value: "__none__", label: "-- None --" },
  ...Object.entries(WIRE_COLORS).map(([code, name]) => ({
    value: name,
    label: `(${code})  ${name}`,
  })).sort((a, b) => a.label.localeCompare(b.label)),
];

export const VENDOR_CODE_MAP: Record<string, string[]> = {
  COP: ["THHN", "TC", "RX", "UF", "BARE"],
  ALU: ["XHHW", "URD", "TRIPLEX", "MHF"],
  COR: ["SEOOW", "SJEOO", "SJEW"],
  ALF: ["ALF", "SGF", "LT", "LTNM"],
};

export function deriveVendorCode(wireDetails: string): string | undefined {
  if (!wireDetails) return undefined;
  const upper = wireDetails.toUpperCase();
  for (const [code, types] of Object.entries(VENDOR_CODE_MAP)) {
    for (const t of types) {
      if (upper.startsWith(t)) return code;
    }
  }
  return undefined;
}

export function buildExportFilename(session: { name: string; firstPhotoAt?: string | null; lastPhotoAt?: string | null }, ext: string): string {
  const safeName = session.name.replace(/[^a-zA-Z0-9 _-]/g, "").replace(/\s+/g, " ").trim();
  const fmtTime = (d: Date) => {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}'${String(m).padStart(2, "0")}${ampm}`;
  };
  const fmtDate = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const first = session.firstPhotoAt ? new Date(session.firstPhotoAt) : null;
  const last = session.lastPhotoAt ? new Date(session.lastPhotoAt) : null;
  if (!first) return `${safeName.replace(/ /g, "_")}.${ext}`;
  const d1 = fmtDate(first);
  const t1 = fmtTime(first);
  if (!last || first.getTime() === last.getTime()) return `${safeName}_${d1}_${t1}.${ext}`;
  const d2 = fmtDate(last);
  const t2 = fmtTime(last);
  if (d1 === d2) return `${safeName}_${d1}_${t1}-${t2}.${ext}`;
  return `${safeName}_${d1}_${t1}-${d2}_${t2}.${ext}`;
}

export function formatSessionTime(firstPhotoAt: string | Date | null, lastPhotoAt: string | Date | null, elapsedOnly = false) {
  if (!firstPhotoAt) return "No photos yet";
  const fmt = (d: string | Date) => new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const timeFmt = (d: string | Date) => new Date(d).toLocaleString(undefined, {
    hour: "2-digit", minute: "2-digit",
  });
  const dateFmt = (d: string | Date) => new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric",
  });
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
  const sameDay = start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();
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
