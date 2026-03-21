export const VENDOR_CODE_MAP: Record<string, string[]> = {
  COP: ["THHN", "TC", "RX", "UF", "BARE"],
  ALU: ["XHHW", "URD", "TRIPLEX", "MHF"],
  COR: ["SEOOW", "SJEOO", "SJEW"],
  ALF: ["ALF", "SGF", "LT", "LTNM"],
  PRI: ["PRI"],
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
