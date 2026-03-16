import {
  CATALOG,
  WIRE_TYPES,
  parseCatalogEntry,
  correctWireDetails,
  type ParsedCatalogEntry,
  type CatalogEntry,
} from "./wireReference";

export type MatchConfidence = "high" | "medium" | "low" | "none";

export interface LabelMatchResult {
  match: ParsedCatalogEntry | null;
  confidence: MatchConfidence;
  normalizedInput: string;
  matchMethod: "exact" | "correction" | "description" | "fuzzy" | "none";
}

function normalize(text: string): string {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

function extractTokens(text: string): string[] {
  return text
    .toUpperCase()
    .replace(/[^A-Z0-9\s\/\-]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 0);
}

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


function tryExactCatalogMatch(normalized: string): ParsedCatalogEntry | null {
  const entry = CATALOG.find(e => e.catalog === normalized);
  return entry ? parseCatalogEntry(entry) : null;
}

function tryCorrectionMatch(raw: string): { entry: ParsedCatalogEntry; confident: boolean } | null {
  const result = correctWireDetails(raw);
  if (result.catalogMatch) {
    return {
      entry: parseCatalogEntry(result.catalogMatch),
      confident: result.confident,
    };
  }
  return null;
}

function tryDescriptionMatch(tokens: string[]): { entry: ParsedCatalogEntry; score: number } | null {
  let bestEntry: CatalogEntry | null = null;
  let bestScore = 0;

  const upperTokens = tokens.map(t => t.toUpperCase());
  const preferredType = WIRE_TYPES.find(wt =>
    upperTokens.some(t => t === wt || t.startsWith(wt + "/") || t.startsWith(wt + "-"))
  ) ?? null;

  const candidates = preferredType
    ? CATALOG.filter(e => e.catalog.startsWith(preferredType))
    : CATALOG;

  for (const entry of candidates) {
    const descUpper = entry.description.toUpperCase();
    const catUpper = entry.catalog.toUpperCase();
    let score = 0;

    for (const token of upperTokens) {
      if (token.length < 2) continue;
      if (descUpper.includes(token)) score += token.length;
      if (catUpper.includes(token)) score += token.length * 1.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestScore >= 15) {
    return { entry: parseCatalogEntry(bestEntry), score: bestScore };
  }
  return null;
}

function tryFuzzyCatalogMatch(normalized: string): { entry: ParsedCatalogEntry; distance: number } | null {
  if (normalized.length < 4) return null;

  let bestEntry: CatalogEntry | null = null;
  let bestDist = Infinity;
  const maxDist = normalized.length >= 10 ? 3 : 2;

  for (const entry of CATALOG) {
    if (Math.abs(entry.catalog.length - normalized.length) > maxDist) continue;
    const dist = levenshtein(normalized, entry.catalog);
    if (dist < bestDist) {
      bestDist = dist;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestDist <= maxDist) {
    return { entry: parseCatalogEntry(bestEntry), distance: bestDist };
  }
  return null;
}

function trySubstringCatalogMatch(normalized: string): ParsedCatalogEntry | null {
  if (normalized.length < 5) return null;

  const matches = CATALOG.filter(e =>
    e.catalog.includes(normalized) || normalized.includes(e.catalog)
  );

  if (matches.length === 1) {
    return parseCatalogEntry(matches[0]);
  }

  if (matches.length > 1) {
    const sorted = matches.sort((a, b) => {
      const diffA = Math.abs(a.catalog.length - normalized.length);
      const diffB = Math.abs(b.catalog.length - normalized.length);
      return diffA - diffB;
    });
    return parseCatalogEntry(sorted[0]);
  }

  return null;
}

function extractPrimaryLine(rawText: string): string {
  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);
  if (lines.length <= 1) return rawText;
  for (const line of lines) {
    const upper = line.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (/^[A-Z]{2,}/.test(upper) && upper.length >= 6) return line;
  }
  return lines[0];
}

export function matchLabelText(rawText: string): LabelMatchResult {
  if (!rawText || rawText.trim().length === 0) {
    return { match: null, confidence: "none", normalizedInput: "", matchMethod: "none" };
  }

  const primaryLine = extractPrimaryLine(rawText);
  const useFullText = primaryLine !== rawText;

  const result = attemptMatch(primaryLine);
  if (result.match) return result;

  if (useFullText) {
    const fallback = attemptMatch(rawText);
    if (fallback.match) {
      if (fallback.confidence === "high") fallback.confidence = "medium";
      return fallback;
    }
  }

  return { match: null, confidence: "none", normalizedInput: normalize(primaryLine), matchMethod: "none" };
}

function attemptMatch(text: string): LabelMatchResult {
  let normalized = normalize(text);
  normalized = normalized.replace(/400R(\d)/g, "40OR$1").replace(/300R(\d)/g, "30OR$1");
  const tokens = extractTokens(text);

  const exactMatch = tryExactCatalogMatch(normalized);
  if (exactMatch) {
    return { match: exactMatch, confidence: "high", normalizedInput: normalized, matchMethod: "exact" };
  }

  const correctionResult = tryCorrectionMatch(text);
  if (correctionResult) {
    return {
      match: correctionResult.entry,
      confidence: correctionResult.confident ? "high" : "medium",
      normalizedInput: normalized,
      matchMethod: "correction",
    };
  }

  const substringMatch = trySubstringCatalogMatch(normalized);
  if (substringMatch) {
    return { match: substringMatch, confidence: "medium", normalizedInput: normalized, matchMethod: "fuzzy" };
  }

  const fuzzyResult = tryFuzzyCatalogMatch(normalized);
  if (fuzzyResult) {
    const confidence: MatchConfidence = fuzzyResult.distance <= 1 ? "medium" : "low";
    return { match: fuzzyResult.entry, confidence, normalizedInput: normalized, matchMethod: "fuzzy" };
  }

  if (tokens.length >= 2) {
    const descResult = tryDescriptionMatch(tokens);
    if (descResult) {
      const confidence: MatchConfidence = descResult.score >= 15 ? "medium" : "low";
      return { match: descResult.entry, confidence, normalizedInput: normalized, matchMethod: "description" };
    }
  }

  if (/\d$/.test(normalized)) {
    let padded = normalized;
    for (let i = 0; i < 3; i++) {
      padded += "0";
      const exactPadded = tryExactCatalogMatch(padded);
      if (exactPadded) {
        return { match: exactPadded, confidence: "medium", normalizedInput: normalized, matchMethod: "fuzzy" };
      }
      const corrPadded = tryCorrectionMatch(padded);
      if (corrPadded) {
        return { match: corrPadded.entry, confidence: corrPadded.confident ? "medium" : "low", normalizedInput: normalized, matchMethod: "correction" };
      }
    }
  }

  if (normalized.startsWith("URD") && normalized.length > 3) {
    const urdBody = normalized.slice(3);
    const variants = [
      urdBody.replace(/7/g, "2"),
      urdBody.replace(/1/g, "2"),
      urdBody.replace(/7/g, "2").replace(/1/g, "2"),
    ];
    for (const v of variants) {
      if (v === urdBody) continue;
      const candidate = "URD" + v;
      const exactUrd = tryExactCatalogMatch(candidate);
      if (exactUrd) {
        return { match: exactUrd, confidence: "medium", normalizedInput: normalized, matchMethod: "fuzzy" };
      }
      const corrUrd = tryCorrectionMatch(candidate);
      if (corrUrd) {
        return { match: corrUrd.entry, confidence: corrUrd.confident ? "medium" : "low", normalizedInput: normalized, matchMethod: "correction" };
      }
    }
  }

  return { match: null, confidence: "none", normalizedInput: normalized, matchMethod: "none" };
}
