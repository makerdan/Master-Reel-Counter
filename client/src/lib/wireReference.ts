export const WIRE_TYPES = [
  "THHN", "XHHW", "URD", "SER", "TC", "RX", "UF", "BARE",
  "ALF", "LT", "LTNM", "MHF", "SEOOW", "SJEW", "SJEOO", "TRIPLEX",
] as const;

export const WIRE_GAUGES = [
  "1", "2", "3", "4", "6", "8",
  "1/0", "2/0", "3/0", "4/0",
  "250", "300", "350", "400", "500", "600", "700", "750", "900",
] as const;

export const WIRE_COLORS: Record<string, string> = {
  BK: "Black",
  WH: "White",
  GY: "Gray",
  BL: "Blue",
  RD: "Red",
  YL: "Yellow",
  OR: "Orange",
  GN: "Green",
};

export const COLOR_CODES = Object.keys(WIRE_COLORS);

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function fuzzyMatch(input: string, candidates: readonly string[] | string[], maxDist = 2): { match: string | null; distance: number } {
  let best: string | null = null;
  let bestDist = Infinity;
  const upper = input.toUpperCase();
  for (const c of candidates) {
    const dist = levenshtein(upper, c.toUpperCase());
    if (dist < bestDist) {
      bestDist = dist;
      best = c;
    }
  }
  if (best && bestDist <= maxDist) {
    return { match: best, distance: bestDist };
  }
  return { match: null, distance: bestDist };
}

export interface CorrectionResult {
  correctedDetails: string;
  wasModified: boolean;
  confident: boolean;
  parts: {
    type?: { original: string; corrected: string | null; confident: boolean };
    gauge?: { original: string; corrected: string | null; confident: boolean };
    color?: { original: string; corrected: string | null; confident: boolean };
    footage?: string;
    remainder?: string;
  };
}

export function correctWireDetails(rawDetails: string): CorrectionResult {
  if (!rawDetails || rawDetails === "UNREADABLE") {
    return { correctedDetails: rawDetails, wasModified: false, confident: false, parts: {} };
  }

  const input = rawDetails.toUpperCase().replace(/[^A-Z0-9/\-]/g, "");
  let remaining = input;
  let correctedParts: string[] = [];
  let overallConfident = true;
  let wasModified = false;
  const parts: CorrectionResult["parts"] = {};

  const typeResult = matchWireType(remaining);
  if (typeResult) {
    parts.type = {
      original: typeResult.original,
      corrected: typeResult.corrected,
      confident: typeResult.confident,
    };
    correctedParts.push(typeResult.corrected || typeResult.original);
    remaining = remaining.slice(typeResult.original.length);
    if (!typeResult.confident) overallConfident = false;
    if (typeResult.corrected && typeResult.corrected !== typeResult.original) wasModified = true;
  }

  const gaugeResult = matchGauge(remaining);
  if (gaugeResult) {
    parts.gauge = {
      original: gaugeResult.original,
      corrected: gaugeResult.corrected,
      confident: gaugeResult.confident,
    };
    correctedParts.push(gaugeResult.corrected || gaugeResult.original);
    remaining = remaining.slice(gaugeResult.original.length);
    if (!gaugeResult.confident) overallConfident = false;
    if (gaugeResult.corrected && gaugeResult.corrected !== gaugeResult.original) wasModified = true;
  }

  const colorResult = matchColor(remaining);
  if (colorResult) {
    parts.color = {
      original: colorResult.original,
      corrected: colorResult.corrected,
      confident: colorResult.confident,
    };
    correctedParts.push(colorResult.corrected || colorResult.original);
    remaining = remaining.slice(colorResult.original.length);
    if (!colorResult.confident) overallConfident = false;
    if (colorResult.corrected && colorResult.corrected !== colorResult.original) wasModified = true;
  }

  if (remaining) {
    const footageMatch = remaining.match(/^(\d+)/);
    if (footageMatch) {
      parts.footage = footageMatch[1];
      correctedParts.push(footageMatch[1]);
      remaining = remaining.slice(footageMatch[0].length);
    }
    if (remaining) {
      parts.remainder = remaining;
      correctedParts.push(remaining);
    }
  }

  const correctedDetails = correctedParts.join("");

  return {
    correctedDetails,
    wasModified,
    confident: overallConfident,
    parts,
  };
}

function matchWireType(s: string): { original: string; corrected: string | null; confident: boolean } | null {
  if (!s) return null;

  for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
    if (s.startsWith(wt)) {
      return { original: wt, corrected: wt, confident: true };
    }
  }

  for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
    const candidate = s.slice(0, wt.length + 1);
    if (candidate.length >= wt.length - 1) {
      const sub = s.slice(0, wt.length);
      const dist = levenshtein(sub, wt);
      if (dist === 1) {
        return { original: sub, corrected: wt, confident: true };
      }
      if (dist === 2 && wt.length >= 3) {
        return { original: sub, corrected: wt, confident: false };
      }
    }
  }

  for (const wt of WIRE_TYPES) {
    if (wt.length + 1 <= s.length) {
      const sub = s.slice(0, wt.length + 1);
      const dist = levenshtein(sub, wt);
      if (dist <= 1) {
        return { original: sub, corrected: wt, confident: true };
      }
    }
  }

  return null;
}

function matchGauge(s: string): { original: string; corrected: string | null; confident: boolean } | null {
  if (!s) return null;

  for (const g of [...WIRE_GAUGES].sort((a, b) => b.length - a.length)) {
    if (s.startsWith(g)) {
      return { original: g, corrected: g, confident: true };
    }
  }

  const numMatch = s.match(/^(\d+(?:\/\d+)?)/);
  if (numMatch) {
    const raw = numMatch[1];
    const result = fuzzyMatch(raw, [...WIRE_GAUGES], 1);
    if (result.match) {
      return {
        original: raw,
        corrected: result.match,
        confident: result.distance === 0,
      };
    }
    return { original: raw, corrected: null, confident: false };
  }

  return null;
}

function matchColor(s: string): { original: string; corrected: string | null; confident: boolean } | null {
  if (!s) return null;

  for (const c of COLOR_CODES) {
    if (s.startsWith(c)) {
      return { original: c, corrected: c, confident: true };
    }
  }

  if (s.length >= 2) {
    const twoChar = s.slice(0, 2);
    const result = fuzzyMatch(twoChar, COLOR_CODES, 1);
    if (result.match) {
      return {
        original: twoChar,
        corrected: result.match,
        confident: result.distance === 0,
      };
    }
  }

  return null;
}
