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

const DESCRIPTION_MATCH_STOPWORDS = new Set([
  "OR", "AND", "IN", "A", "THE", "OF", "FOR", "WITH", "BY", "AT", "TO",
  "WIRE", "CABLE", "BRAND",
]);

const COLOR_NAME_TO_CODE: Record<string, string> = {
  BLACK: "BK", WHITE: "WH", GRAY: "GY", BLUE: "BL", RED: "RD",
  YELLOW: "YL", ORANGE: "OR", GREEN: "GN", BROWN: "BR", PURPLE: "PR",
  PINK: "PK",
};

function tryDescriptionMatch(tokens: string[]): { entry: ParsedCatalogEntry; score: number } | null {
  let bestEntry: CatalogEntry | null = null;
  let bestScore = 0;

  const upperTokens = tokens.map(t => t.toUpperCase());

  let preferredType = WIRE_TYPES.find(wt =>
    upperTokens.some(t => t === wt || t.startsWith(wt + "/") || t.startsWith(wt + "-"))
  ) ?? null;
  if (!preferredType) {
    const hasThwn = upperTokens.some(t => t === "THWN" || t.startsWith("THWN-"));
    if (hasThwn) preferredType = "THHN";
  }

  const candidates = preferredType
    ? CATALOG.filter(e => e.catalog.startsWith(preferredType))
    : CATALOG;

  const scoringTokens: string[] = [];
  for (const t of upperTokens) {
    const parts = t.split("-");
    if (parts.length > 1) {
      scoringTokens.push(...parts.filter(p => p.length > 0));
    } else {
      scoringTokens.push(t);
    }
  }

  for (const entry of candidates) {
    const descUpper = entry.description.toUpperCase();
    const catUpper = entry.catalog.toUpperCase();
    let score = 0;

    for (let token of scoringTokens) {
      const ftStripped = token.replace(/^(\d+)FT$/, "$1");
      if (ftStripped !== token) token = ftStripped;

      if (DESCRIPTION_MATCH_STOPWORDS.has(token)) continue;

      const isSingleDigit = token.length === 1 && /^\d$/.test(token);
      if (token.length < 2 && !isSingleDigit) continue;
      if (!isSingleDigit && descUpper.includes(token)) score += token.length;
      if (catUpper.includes(token)) score += token.length * 1.5;

      const colorCode = COLOR_NAME_TO_CODE[token];
      if (colorCode && catUpper.includes(colorCode)) {
        score += colorCode.length * 1.5;
      }
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
  let bestIsPrefix = false;
  const maxDist = normalized.length >= 10 ? 3 : 2;

  for (const entry of CATALOG) {
    if (Math.abs(entry.catalog.length - normalized.length) > maxDist) continue;
    const dist = levenshtein(normalized, entry.catalog);
    if (dist > maxDist) continue;
    const isPrefix = entry.catalog.startsWith(normalized) || normalized.startsWith(entry.catalog);
    if (dist < bestDist || (dist === bestDist && isPrefix && !bestIsPrefix)) {
      bestDist = dist;
      bestEntry = entry;
      bestIsPrefix = isPrefix;
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
    if (/[A-Z]{2,}/.test(upper) && /\d/.test(upper) && upper.length >= 6) return line;
  }
  return lines[0];
}

function lineHasWireType(line: string): boolean {
  const tokens = extractTokens(line);
  return tokens.some(token =>
    WIRE_TYPES.some(wt => token === wt || token.startsWith(wt + "/") || token.startsWith(wt + "-"))
  );
}

function downgradedResult(result: LabelMatchResult): LabelMatchResult {
  if (result.confidence === "high") {
    return { ...result, confidence: "medium" };
  }
  return result;
}

function confidenceRank(c: MatchConfidence): number {
  return { none: 0, low: 1, medium: 2, high: 3 }[c];
}

function stripDatePatterns(text: string): string {
  // Matches MM-DD-YY, MM-DD-YYYY, MM/DD/YY, MM/DD/YYYY with optional leading zeros
  return text.replace(/\b\d{1,2}[-\/]\d{1,2}[-\/]\d{2,4}\b/g, " ").replace(/\s{2,}/g, " ").trim();
}

function coreMatchLabelText(rawText: string): LabelMatchResult {
  if (!rawText || rawText.trim().length === 0) {
    return { match: null, confidence: "none", normalizedInput: "", matchMethod: "none" };
  }

  const lines = rawText.split(/\n/).map(l => l.trim()).filter(l => l.length > 0);

  if (lines.length <= 1) {
    return attemptMatch(rawText);
  }

  // Step 1: Per-line wire type scanning — try each line that contains a known wire type as any token
  for (const line of lines) {
    if (lineHasWireType(line)) {
      const result = attemptMatch(line);
      if (result.match) return result;
    }
  }

  // Step 2: Existing primary line heuristic (first line with letters+digits+length>=6)
  // If the primary line matches via description only, keep it as a fallback so Steps 3 and 4
  // can still run — they may find a better match by combining lines (e.g. gauge-prefixed wire type).
  const primaryLine = extractPrimaryLine(rawText);
  const primaryResult = attemptMatch(primaryLine);
  let descriptionFallback: LabelMatchResult | null = null;
  if (primaryResult.match) {
    if (primaryResult.matchMethod !== "description") {
      return primaryResult;
    }
    descriptionFallback = primaryResult;
  }

  // Step 3: Adjacent-line combination — try merging consecutive line pairs
  for (let i = 0; i < lines.length - 1; i++) {
    const withSpace = lines[i] + " " + lines[i + 1];
    const withSpaceResult = attemptMatch(withSpace);
    if (withSpaceResult.match) return downgradedResult(withSpaceResult);

    const noSpace = lines[i] + lines[i + 1];
    const noSpaceResult = attemptMatch(noSpace);
    if (noSpaceResult.match) return downgradedResult(noSpaceResult);
  }

  // Step 4: Full text fallback
  const fallback = attemptMatch(rawText);
  if (fallback.match) return downgradedResult(fallback);

  // Fall back to the description-only primary result (downgraded confidence)
  if (descriptionFallback) return downgradedResult(descriptionFallback);

  return { match: null, confidence: "none", normalizedInput: normalize(primaryLine), matchMethod: "none" };
}

function attemptMatch(text: string): LabelMatchResult {
  let normalized = normalize(text);
  normalized = normalized.replace(/400R(\d)/g, "40OR$1").replace(/300R(\d)/g, "30OR$1");
  normalized = normalized.replace(/[S5](BK|RD|WH|BL|GR|GN|YL|OR|GY|BR|PK|VI|TN)/g, "8$1");
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

export function matchLabelText(rawText: string): LabelMatchResult {
  const result = coreMatchLabelText(rawText);

  if (result.confidence !== "high") {
    const dateStripped = stripDatePatterns(rawText);
    if (dateStripped !== rawText.trim()) {
      const strippedResult = coreMatchLabelText(dateStripped);
      if (confidenceRank(strippedResult.confidence) > confidenceRank(result.confidence)) {
        return strippedResult;
      }
    }
  }

  return result;
}
