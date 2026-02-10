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
  BR: "Brown",
  PR: "Purple",
};

export const COLOR_CODES = Object.keys(WIRE_COLORS);

export const VENDOR_CODES = ["ALU", "COP", "ALF"] as const;

export interface CatalogEntry {
  vendor: string;
  catalog: string;
  description: string;
}

export const CATALOG: CatalogEntry[] = [
  { vendor: "ALU", catalog: "4TRIPLEX1500", description: "#4 TRIPLEX PERIWINKLE XLP" },
  { vendor: "ALU", catalog: "4TRIPLEX500", description: "#4 TRIPLEX PERIWINKLE COIL" },
  { vendor: "ALU", catalog: "6TRIPLEX500", description: "6 TRIPLEX VOLUTA XLP 500'" },
  { vendor: "ALU", catalog: "MHF40402041000", description: "4/0-4/0-2/0-4 MOBILE HOME FEEDER ALU 1000'" },
  { vendor: "ALU", catalog: "SER13WG1000", description: "SER 1-1-1-3 ALU 1000'" },
  { vendor: "ALU", catalog: "SER20WG1000", description: "SER 2/0-2/0-2/0-1 ALU 1000'" },
  { vendor: "ALU", catalog: "SER22241000", description: "SER 2-2-2-4 ALU 1000'" },
  { vendor: "ALU", catalog: "SER401000", description: "SER 4/0-4/0-4/0-2/0 ALU 1000'" },
  { vendor: "ALU", catalog: "THHN1GN2500", description: "AL THHN #1 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "THHN400BR2500", description: "ALU THHN 400 STR BROWN 2500'" },
  { vendor: "ALU", catalog: "URD101000", description: "1/0 URD BRENAU ALU 1000'" },
  { vendor: "ALU", catalog: "URD201000", description: "2/0 URD CONVERSE ALU 1000'" },
  { vendor: "ALU", catalog: "URD21000", description: "URD 2-2-4 STEPHENS ALU 1000'" },
  { vendor: "ALU", catalog: "URD22241000", description: "2-2-2-4 URD DYKE ALU 1000'" },
  { vendor: "ALU", catalog: "URD2501000", description: "250 PRATT ALU 1000'" },
  { vendor: "ALU", catalog: "URD401000", description: "4/0 URD SWEETBRIAR ALU 1000'" },
  { vendor: "ALU", catalog: "URD4040401000", description: "4/0-4/0-4/0 URD MONMOUTH ALU 1000'" },
  { vendor: "ALU", catalog: "URD41000", description: "4 URD VASSAR ALU 1000'" },
  { vendor: "ALU", catalog: "XHHW10BK5000", description: "AL XHHW 1/0 STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW1BK5000", description: "AL XHHW #1 STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW1GN2500", description: "AL XHHW #1 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW20BK1000", description: "AL XHHW 2/0 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW2500R2500", description: "AL XHHW 250 STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW250BK1000", description: "AL XHHW 250 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW250BK2500", description: "AL XHHW 250 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW250BK5000", description: "AL XHHW 250 STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW250GN2500", description: "AL XHHW 250 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW2BK5000", description: "AL XHHW #2 STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW300BK2500", description: "AL XHHW 300 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW300BL2500", description: "AL XHHW 300 STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW300BR2500", description: "AL XHHW 300 STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW300GY2500", description: "AL XHHW 300 STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW300RD2500", description: "AL XHHW 300 STR RED 2500'" },
  { vendor: "ALU", catalog: "XHHW300WH2500", description: "AL XHHW 300 STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW30GN2500", description: "AL XHHW 3/0 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW350BK1000", description: "AL XHHW 350 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW350BK2500", description: "AL XHHW 350 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW400GY2500", description: "AL XHHW 400 STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW40BK1000", description: "AL XHHW 4/0 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW500BK1000", description: "AL XHHW 500 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW500BK2500", description: "AL XHHW 500 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW500BL2500", description: "AL XHHW 500 STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW500WH2500", description: "AL XHHW 500 STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW500YL2500", description: "AL XHHW 500 STR YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW6000R2500", description: "AL XHHW 600 STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW600BK1000", description: "AL XHHW 600 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW600BK2500", description: "AL XHHW 600 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW600BR2500", description: "AL XHHW 600 STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW600RD2500", description: "AL XHHW 600 RED 2500'" },
  { vendor: "ALU", catalog: "XHHW600YL2500", description: "AL XHHW 600 STR YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW6BK1000", description: "AL XHHW #6 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW7500R2500", description: "AL XHHW 750 STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW750BK2500", description: "AL XHHW 750 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW750BL2500", description: "AL XHHW 750 STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW750BR2500", description: "AL XHHW 750 STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW750GY2500", description: "AL XHHW 750 STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW750RD2500", description: "AL XHHW 750 STR RED 2500'" },
  { vendor: "ALU", catalog: "XHHW750WH2500", description: "AL XHHW 750 STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW750YL2500", description: "AL XHHW 750 STR YELLOW 2500'" },
  { vendor: "COP", catalog: "BARE20ST1000", description: "BARE CU 2/0-19 STR 1000" },
  { vendor: "COP", catalog: "BARE40ST1000", description: "BARE CU 4/0 STR 1000" },
  { vendor: "COP", catalog: "RX62WG2500", description: "6/2 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX82WG2500", description: "8/2 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX83WG2500", description: "8/3 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "SER30WG500", description: "CU 3/0-3/0-3/0-1/0 WG SER CABLE-500'" },
  { vendor: "COP", catalog: "TC1031000", description: "10/3 WOG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1041000", description: "10/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1042500", description: "10/4 TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC1231000", description: "12/3 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1241000", description: "12/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1242500", description: "12/4 TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC1431000", description: "14/3 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1441000", description: "14/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1451000", description: "14/5 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC203WG500", description: "2/0-3WG TRAY CABLE 500" },
  { vendor: "COP", catalog: "TC43WG1000", description: "4/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC63WG1000", description: "6/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC83WG1000", description: "8/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC83WG2500", description: "8/3 WG TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC83WG500", description: "8/3 WG TRAY CABLE-500'" },
  { vendor: "COP", catalog: "THHN100R5000", description: "THHN 1/0 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN10BR5000", description: "THHN 1/0 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN10R5000", description: "THHN 1 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN10RD5000", description: "THHN 1/0 STR RED 5000'" },
  { vendor: "COP", catalog: "THHN10WH5000", description: "THHN 1/0 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN10YL5000", description: "THHN 1/0 STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN1BK1000", description: "THHN 1 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN1BK2500", description: "THHN 1 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN1BK500", description: "THHN 1 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN1BK5000", description: "THHN 1 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN1BL5000", description: "THHN 1 STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN1BR5000", description: "THHN 1 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN1GN5000", description: "THHN 1 STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN1WH5000", description: "THHN 1 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN1YL5000", description: "THHN 1 STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN200R5000", description: "THHN 2/0 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN20BK1000", description: "THHN 2/0 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN20BK2500", description: "THHN 2/0 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN20BK500", description: "THHN 2/0 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN20GN2500", description: "THHN 2/0 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN20GN5000", description: "THHN 2/0 STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN20R5000", description: "THHN 2 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN20RD2500", description: "THHN 2/0 STR RED 2500'" },
  { vendor: "COP", catalog: "THHN20RD5000", description: "THHN 2/0 STR RED 5000'" },
  { vendor: "COP", catalog: "THHN20WH1000", description: "THHN 2/0 STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN2500R2500", description: "THHN 250 STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN250BK1000", description: "THHN 250 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN250BK2500", description: "THHN 250 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN250BK500", description: "THHN 250 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN250BR2500", description: "THHN 250 STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN250RD2500", description: "THHN 250 STR RED 2500'" },
  { vendor: "COP", catalog: "THHN250WH2500", description: "THHN 250 STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN250YL2500", description: "THHN 250 STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN2BK1000", description: "THHN 2 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN2BK2500", description: "THHN 2 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN2BK500", description: "THHN 2 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN2BK5000", description: "THHN 2 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN2BL5000", description: "THHN 2 STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN2BR5000", description: "THHN 2 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN2GN2500", description: "THHN 2 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN2RD5000", description: "THHN 2 STR RED 5000'" },
  { vendor: "COP", catalog: "THHN2WH5000", description: "THHN 2 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN2YL5000", description: "THHN 2 STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN3000R2500", description: "THHN 300 STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN300GN2500", description: "THHN 300 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN300GY2500", description: "THHN 300 STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN300R5000", description: "THHN 3/0 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN300WH2500", description: "THHN 300 STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN30BK1000", description: "THHN 3/0 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN30BK2500", description: "THHN 3/0 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN30BK500", description: "THHN 3/0 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN30BK5000", description: "THHN 3/0 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN30BL2500", description: "THHN 3/0 STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN30BL5000", description: "THHN 3/0 STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN30GN2500", description: "THHN 3/0 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN30GN5000", description: "THHN 3/0 STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN30GY5000", description: "THHN 3/0 STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN350BK500", description: "THHN 350 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN350GY2500", description: "THHN 350 STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN350RD2500", description: "THHN 350 STR RED 2500'" },
  { vendor: "COP", catalog: "THHN350WH2500", description: "THHN 350 STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN350YL2500", description: "THHN 350 STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN3BK1000", description: "THHN 3 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN3BK500", description: "THHN 3 STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN3BL5000", description: "THHN 3 STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN3BR5000", description: "THHN 3 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN3WH5000", description: "THHN 3 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN400BK2500", description: "THHN 400 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN400BL2500", description: "THHN 400 STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN400BR2500", description: "THHN 400 STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN400R5000", description: "THHN 4/0 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN40BK1000", description: "THHN 4/0 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN40BK5000", description: "THHN 4/0 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN40BL2500", description: "THHN 4/0 STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN40BL5000", description: "THHN 4/0 STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN40BR2500", description: "THHN 4/0 STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN40BR5000", description: "THHN 4/0 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN40GN2500", description: "THHN 4/0 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN40GY2500", description: "THHN 4/0 STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN40R5000", description: "THHN 4 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN40RD5000", description: "THHN 4/0 STR RED 5000'" },
  { vendor: "COP", catalog: "THHN40WH5000", description: "THHN 4/0 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN40YL5000", description: "THHN 4/0 STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN4BK2500", description: "THHN 4 STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN4BR5000", description: "THHN 4 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN4GN2500", description: "THHN 4 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN4YL5000", description: "THHN 4 STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN500BK1000", description: "THHN 500 STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN500BL2500", description: "THHN 500 STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN500GY2500", description: "THHN 500 STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN500PR2500", description: "THHN 500 STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN6000R2000", description: "THHN 600 STR ORANGE 2000'" },
  { vendor: "COP", catalog: "THHN600GY2000", description: "THHN 600 STR GRAY 2000'" },
  { vendor: "COP", catalog: "THHN600RD2000", description: "THHN 600 STR RED 2000'" },
  { vendor: "COP", catalog: "THHN600YL2000", description: "THHN 600 STR YELLOW 2000'" },
  { vendor: "COP", catalog: "THHN6BK5000", description: "THHN 6 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN6GN2500", description: "THHN 6 STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN6GN5000", description: "THHN 6 STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN6RD2500", description: "THHN 6 STR RED 2500'" },
  { vendor: "COP", catalog: "THHN80R5000", description: "THHN 8 STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN8BK5000", description: "THHN 8 STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN8BR5000", description: "THHN 8 STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN8RD2500", description: "THHN 8 STR RED 2500'" },
  { vendor: "COP", catalog: "THHN8WH5000", description: "THHN 8 STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN8YL5000", description: "THHN 8 STR YELLOW 5000'" },
];

const CATALOG_CODES = CATALOG.map(c => c.catalog);

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
  catalogMatch?: CatalogEntry;
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

  const input = rawDetails.toUpperCase().replace(/[^A-Z0-9\-]/g, "");

  const catalogResult = matchCatalog(input);
  if (catalogResult) {
    return {
      correctedDetails: catalogResult.entry.catalog,
      wasModified: catalogResult.entry.catalog !== input,
      confident: catalogResult.confident,
      catalogMatch: catalogResult.entry,
      parts: {},
    };
  }

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

  const detectedType = (typeResult?.corrected || typeResult?.original || "").toUpperCase();
  const skipColor = detectedType === "TC";

  const colorResult = !skipColor ? matchColor(remaining) : null;
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

function matchCatalog(input: string): { entry: CatalogEntry; confident: boolean } | null {
  for (const entry of CATALOG) {
    if (entry.catalog === input) {
      return { entry, confident: true };
    }
  }

  const maxDist = input.length >= 10 ? 2 : 1;
  let bestEntry: CatalogEntry | null = null;
  let bestDist = Infinity;
  for (const entry of CATALOG) {
    if (Math.abs(entry.catalog.length - input.length) > 1) continue;
    const dist = levenshtein(input, entry.catalog);
    if (dist < bestDist) {
      bestDist = dist;
      bestEntry = entry;
    }
  }

  if (bestEntry && bestDist <= maxDist) {
    return { entry: bestEntry, confident: bestDist <= 1 };
  }

  return null;
}

function matchWireType(s: string): { original: string; corrected: string | null; confident: boolean } | null {
  if (!s) return null;

  for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
    if (s.startsWith(wt)) {
      return { original: wt, corrected: wt, confident: true };
    }
  }

  for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
    const sub = s.slice(0, wt.length);
    if (sub.length >= wt.length) {
      const dist = levenshtein(sub, wt);
      if (dist === 1 && wt.length >= 3) {
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

  return null;
}
