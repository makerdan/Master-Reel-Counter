import {
  CATALOG,
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

  for (const entry of CATALOG) {
    const descUpper = entry.description.toUpperCase();
    const catUpper = entry.catalog.toUpperCase();
    let score = 0;

    for (const token of tokens) {
      if (token.length < 2) continue;
      if (descUpper.includes(token)) score += token.length;
      if (catUpper.includes(token)) score += token.length * 1.5;
    }

    if (score > bestScore) {
      bestScore = score;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestScore >= 6) {
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

export function matchLabelText(rawText: string): LabelMatchResult {
  if (!rawText || rawText.trim().length === 0) {
    return { match: null, confidence: "none", normalizedInput: "", matchMethod: "none" };
  }

  const normalized = normalize(rawText);
  const tokens = extractTokens(rawText);

  const exactMatch = tryExactCatalogMatch(normalized);
  if (exactMatch) {
    return { match: exactMatch, confidence: "high", normalizedInput: normalized, matchMethod: "exact" };
  }

  const correctionResult = tryCorrectionMatch(rawText);
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

  return { match: null, confidence: "none", normalizedInput: normalized, matchMethod: "none" };
}
