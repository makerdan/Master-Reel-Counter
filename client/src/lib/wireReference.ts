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
  PK: "Pink",
};

export const COLOR_CODES = Object.keys(WIRE_COLORS);

export const VENDOR_CODES = ["ALU", "COP", "COR", "ALF", "PRI"] as const;

export interface CatalogEntry {
  vendor: string;
  catalog: string;
  description: string;
}

export interface ParsedCatalogEntry extends CatalogEntry {
  wireType?: string;
  wireSize?: string;
  color?: string;
  footage?: number;
  conductors?: string;
  aliasLabel?: string;
}

export interface CatalogAlias {
  alias: string;
  catalog: string;
  vendor: string;
}

export const CATALOG_ALIASES: CatalogAlias[] = [
  { alias: "25001XHHWALOR", catalog: "XHHW250OR1000", vendor: "ALU" },
  { alias: "25001XHHWALBR", catalog: "XHHW250BR1000", vendor: "ALU" },
  { alias: "25001XHHWALBN", catalog: "XHHW250BR1000", vendor: "ALU" },
];

export function parseCatalogEntry(entry: CatalogEntry): ParsedCatalogEntry {
  const desc = entry.description;
  let wireType: string | undefined;
  let wireSize: string | undefined;
  let color: string | undefined;
  let footage: number | undefined;

  for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
    if (entry.catalog.toUpperCase().startsWith(wt)) {
      wireType = wt;
      break;
    }
  }
  if (!wireType) {
    for (const wt of [...WIRE_TYPES].sort((a, b) => b.length - a.length)) {
      if (desc.toUpperCase().includes(wt)) {
        wireType = wt;
        break;
      }
    }
  }

  const sizeMatch = desc.match(/#?(\d+\/\d+|\d+)\s/);
  if (sizeMatch) {
    wireSize = sizeMatch[1];
  }

  const colorNames: Record<string, string> = {
    BLACK: "BK", WHITE: "WH", GRAY: "GY", BLUE: "BL", RED: "RD",
    YELLOW: "YL", ORANGE: "OR", GREEN: "GN", BROWN: "BR", PURPLE: "PR",
    PINK: "PK",
  };
  for (const [name, code] of Object.entries(colorNames)) {
    if (desc.toUpperCase().includes(name)) {
      color = code;
      break;
    }
  }

  const footageMatch = desc.match(/(\d+)(?:'|\s*[Ff][Tt]\.?)?\s*$/);
  if (footageMatch) {
    footage = parseInt(footageMatch[1]);
  }

  let conductors: string | undefined;
  if (desc.toUpperCase().includes("TRIPLEX")) {
    conductors = "3";
  } else if (desc.toUpperCase().includes("QUADRUPLEX") || desc.toUpperCase().includes("QUADPLEX")) {
    conductors = "4";
  } else if (desc.toUpperCase().includes("DUPLEX")) {
    conductors = "2";
  } else {
    const multiConductorMatch = desc.match(/(\d+(?:\/\d+)?(?:-\d+(?:\/\d+)?){1,})/);
    if (multiConductorMatch) {
      const parts = multiConductorMatch[1].split("-");
      if (parts.length >= 2) {
        conductors = parts.length.toString();
      }
    } else {
      const descSlash = desc.match(/(\d+)\/(\d)\s/);
      if (descSlash && !desc.match(/\d+\/0/)) {
        conductors = descSlash[2];
      }
    }
  }

  return { ...entry, wireType, wireSize, color, footage, conductors };
}

export const CATALOG: CatalogEntry[] = [
  { vendor: "ALU", catalog: "4TRIPLEX1500", description: "TRIPLEX PERIWINKLE 4 AWG 3C 1500'" },
  { vendor: "ALU", catalog: "4TRIPLEX500", description: "TRIPLEX VOLUTA 4 AWG 3C 500'" },
  { vendor: "ALU", catalog: "6TRIPLEX500", description: "TRIPLEX VOLUTA 6 AWG 3C 500'" },
  { vendor: "ALU", catalog: "MHF40402041000", description: "MHF (MOBILE HOME FEEDER) 4/0 AWG 2C 2/0 AWG 4 AWG WITH GROUND 1000'" },
  { vendor: "ALU", catalog: "SER101000", description: "SER 1/0 ALU 1000'" },
  { vendor: "ALU", catalog: "SER13WG1000", description: "SER (SERVICE ENTRANCE CABLE) 1 AWG 3C 3 AWG WITH GROUND 1000'" },
  { vendor: "ALU", catalog: "SER20WG1000", description: "SER (SERVICE ENTRANCE CABLE) 2/0 AWG 3C 1 AWG WITH GROUND 1000'" },
  { vendor: "ALU", catalog: "SER22241000", description: "SER (SERVICE ENTRANCE CABLE) 2 AWG 3C 4 AWG WITH GROUND 1000'" },
  { vendor: "ALU", catalog: "SER401000", description: "SER (SERVICE ENTRANCE CABLE) 4/0 AWG 3C 2/0 AWG WITH GROUND 1000'" },
  { vendor: "ALU", catalog: "SER40500", description: "SER 4/0 AWG ALU 500'" },
  { vendor: "ALU", catalog: "THHN1GN2500", description: "THHN 1 AWG STR GREEN 2500'" },
  { vendor: "ALU", catalog: "THHN400BR2500", description: "THHN 400 KCMIL STR BROWN 2500'" },
  { vendor: "ALU", catalog: "URD101000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) BRENAU 1/0 AWG 1000'" },
  { vendor: "ALU", catalog: "URD201000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) CONVERSE 2/0 AWG 1000'" },
  { vendor: "ALU", catalog: "URD21000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) STEPHENS 2 AWG 2C 4 AWG 1000'" },
  { vendor: "ALU", catalog: "URD22241000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) DYKE 2 AWG 3C 4 AWG 1000'" },
  { vendor: "ALU", catalog: "URD2501000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) PRATT 250 KCMIL 1000'" },
  { vendor: "ALU", catalog: "URD401000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) SWEETBRIAR 4/0 AWG 1000'" },
  { vendor: "ALU", catalog: "URD4040401000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) MONMOUTH 4/0 AWG 3C 1000'" },
  { vendor: "ALU", catalog: "URD41000", description: "URD (UNDERGROUND DISTRIBUTION CABLE) VASSAR 4 AWG 1000'" },
  { vendor: "ALU", catalog: "XHHW10BK1000", description: "AL XHHW 1/0 STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW10BK5000", description: "XHHW 1/0 AWG STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW1BK5000", description: "XHHW 1 AWG STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW1GN2500", description: "XHHW 1 AWG STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW20BK1000", description: "XHHW 2/0 AWG STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW20GN2500", description: "AL XHHW 2/0 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW20BK5000", description: "XHHW SIZE 2/0 KCMIL WIRE CABLE BLACK AT 5000 FT" },
  { vendor: "ALU", catalog: "XHHW250BK1000", description: "XHHW 250 KCMIL STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW250BK2500", description: "XHHW 250 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW250BK5000", description: "XHHW 250 KCMIL STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW2500R2500", description: "XHHW 250 KCMIL STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW250BR1000", description: "AL XHHW 250 KCMIL BROWN 1000'" },
  { vendor: "ALU", catalog: "XHHW250BR2500", description: "AL XHHW 250 KCMIL BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW250GN2500", description: "XHHW 250 KCMIL STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW250GY2500", description: "AL XHHW 250 KCMIL GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW250OR1000", description: "AL XHHW 250 KCMIL ORANGE 1000'" },
  { vendor: "ALU", catalog: "XHHW250OR2500", description: "AL XHHW 250 ORANGE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW250RD2500", description: "AL XHHW 250 KCMIL RED 2500'" },
  { vendor: "ALU", catalog: "XHHW250WH2500", description: "AL XHHW 250 WHITE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW250YL2500", description: "AL XHHW 250 KCMIL YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW2BK2500", description: "AL XHHW #2 STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW2BK5000", description: "XHHW 2 AWG STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW300BK2500", description: "XHHW 300 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW300BL2500", description: "XHHW 300 KCMIL STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW300BR2500", description: "XHHW 300 KCMIL STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW300GY2500", description: "XHHW 300 KCMIL STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW300OR2500", description: "AL XHHW 300 ORANGE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW300RD2500", description: "XHHW 300 KCMIL STR RED 2500'" },
  { vendor: "ALU", catalog: "XHHW300WH2500", description: "XHHW 300 KCMIL STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW300YL2500", description: "AL XHHW 300 YELLOW CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW30BK5000", description: "AL XHHW 3/0 STR BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW30GN2500", description: "XHHW 3/0 AWG STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW30WH5000", description: "AL XHHW 3/0 WHITE CABLE 5000 FT" },
  { vendor: "ALU", catalog: "XHHW350BK1000", description: "XHHW 350 KCMIL STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW350BK2500", description: "XHHW 350 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW350BK5000", description: "AL XHHW 350 KCMIL BLACK 5000'" },
  { vendor: "ALU", catalog: "XHHW350BL2500", description: "AL XHHW 350 BLUE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW350BR2500", description: "AL XHHW 350 KCMIL BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW350BR5000", description: "AL XHHW 350 KCMIL BROWN 5000'" },
  { vendor: "ALU", catalog: "XHHW350GY2500", description: "AL XHHW 350 KCMIL GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW350OR2500", description: "AL XHHW 350 ORANGE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW350RD2500", description: "AL XHHW 350 RED CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW350WH2500", description: "AL XHHW 350 WHITE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW350YL2500", description: "AL XHHW 350 YELLOW CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400BK2500", description: "AL XHHW 400 BLACK CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400BL2500", description: "AL XHHW 400 BLUE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400BR2500", description: "AL XHHW 400 BROWN CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400GY2500", description: "XHHW 400 KCMIL STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW400OR2500", description: "AL XHHW 400 ORANGE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400RD2500", description: "AL XHHW 400 RED CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400WH2500", description: "AL XHHW 400 WHITE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW400YL2500", description: "AL XHHW 400 YELLOW CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW40BK1000", description: "XHHW 4/0 AWG STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW40BR5000", description: "AL XHHW 40 (4/0) AWG BROWN 5000'" },
  { vendor: "ALU", catalog: "XHHW40GN2500", description: "AL XHHW 4/0 STR GREEN 2500'" },
  { vendor: "ALU", catalog: "XHHW40WH5000", description: "AL XHHW 4/0 WHITE CABLE 5000 FT" },
  { vendor: "ALU", catalog: "XHHW40YL5000", description: "AL XHHW 4/0 YELLOW CABLE 5000 FT" },
  { vendor: "ALU", catalog: "XHHW4BK5000", description: "AL XHHW 4 BLACK CABLE 5000 FT" },
  { vendor: "ALU", catalog: "XHHW500BK1000", description: "XHHW 500 KCMIL STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW500BK2500", description: "XHHW 500 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW500BL2500", description: "XHHW 500 KCMIL STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW500GY2500", description: "XHHW SIZE 500 KCMIL WIRE CABLE GRAY AT 2500 FT" },
  { vendor: "ALU", catalog: "XHHW500OR2500", description: "AL XHHW 500 KCMIL ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW500WH2500", description: "XHHW 500 KCMIL STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW500YL2500", description: "XHHW 500 KCMIL STR YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW6000R2500", description: "XHHW 600 KCMIL STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW600BK1000", description: "XHHW 600 KCMIL STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW600BK2500", description: "XHHW 600 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW600BR2500", description: "XHHW 600 KCMIL STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW600RD2500", description: "XHHW 600 KCMIL STR RED 2500'" },
  { vendor: "ALU", catalog: "XHHW600WH2500", description: "XHHW 600 WHITE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW600YL2500", description: "XHHW 600 KCMIL STR YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW6BK1000", description: "XHHW 6 AWG STR BLACK 1000'" },
  { vendor: "ALU", catalog: "XHHW7500R2500", description: "XHHW 750 KCMIL STR ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW750BK500", description: "AL XHHW 750 BLACK CABLE 500 FT" },
  { vendor: "ALU", catalog: "XHHW750BK1000", description: "AL XHHW 750 BLACK CABLE 1000 FT" },
  { vendor: "ALU", catalog: "XHHW750BK2500", description: "XHHW 750 KCMIL STR BLACK 2500'" },
  { vendor: "ALU", catalog: "XHHW750BL2500", description: "XHHW 750 KCMIL STR BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW750BR500", description: "AL XHHW 750 BROWN CABLE 500 FT" },
  { vendor: "ALU", catalog: "XHHW750BR1000", description: "AL XHHW 750 BROWN CABLE 1000 FT" },
  { vendor: "ALU", catalog: "XHHW750BR2500", description: "XHHW 750 KCMIL STR BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW750GY2500", description: "XHHW 750 KCMIL STR GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW750OR500", description: "AL XHHW 750 ORANGE CABLE 500 FT" },
  { vendor: "ALU", catalog: "XHHW750OR1000", description: "AL XHHW 750 ORANGE CABLE 1000 FT" },
  { vendor: "ALU", catalog: "XHHW750OR2500", description: "AL XHHW 750 ORANGE CABLE 2500 FT" },
  { vendor: "ALU", catalog: "XHHW750RD2500", description: "XHHW 750 KCMIL STR RED 2500'" },
  { vendor: "ALU", catalog: "XHHW750WH2500", description: "XHHW 750 KCMIL STR WHITE 2500'" },
  { vendor: "ALU", catalog: "XHHW750YL2500", description: "XHHW 750 KCMIL STR YELLOW 2500'" },
  { vendor: "ALU", catalog: "XHHW750YL1000", description: "AL XHHW 750 KCMIL YELLOW 1000'" },
  { vendor: "ALU", catalog: "XHHW750YL500", description: "AL XHHW 750 YELLOW 500'" },
  { vendor: "ALU", catalog: "XHHW600BR2000", description: "AL XHHW 600 KCMIL BROWN 2000'" },
  { vendor: "ALU", catalog: "XHHW600YL2000", description: "AL XHHW 600 KCMIL YELLOW 2000'" },
  { vendor: "ALU", catalog: "XHHW600OR2000", description: "AL XHHW 600 KCMIL ORANGE 2000'" },
  { vendor: "ALU", catalog: "XHHW600OR2500", description: "AL XHHW 600 KCMIL ORANGE 2500'" },
  { vendor: "ALU", catalog: "XHHW600GY2000", description: "AL XHHW 600 KCMIL GRAY 2000'" },
  { vendor: "ALU", catalog: "XHHW600GY2500", description: "AL XHHW 600 KCMIL GRAY 2500'" },
  { vendor: "ALU", catalog: "XHHW600BL2500", description: "AL XHHW 600 KCMIL BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW500BR2500", description: "AL XHHW 500 KCMIL BROWN 2500'" },
  { vendor: "ALU", catalog: "XHHW500RD2500", description: "AL XHHW 500 KCMIL RED 2500'" },
  { vendor: "ALU", catalog: "XHHW250BL2500", description: "AL XHHW 250 KCMIL BLUE 2500'" },
  { vendor: "ALU", catalog: "XHHW40OR5000", description: "AL XHHW 4/0 AWG ORANGE 5000'" },
  { vendor: "COP", catalog: "BARE20ST1000", description: "BARE CU 2/0-19 STR 1000" },
  { vendor: "COP", catalog: "BARE40ST1000", description: "BARE CU 4/0 STR 1000" },
  { vendor: "COP", catalog: "RX43WG500", description: "4/3 WG ROMEX-500'" },
  { vendor: "COP", catalog: "RX62WG2500", description: "6/2 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX63WG1000", description: "6/3 WG ROMEX-1000'" },
  { vendor: "COP", catalog: "RX63WG2500", description: "6/3 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX82WG2500", description: "8/2 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX83WG1000", description: "8/3 WG ROMEX-1000'" },
  { vendor: "COP", catalog: "RX83WG2500", description: "8/3 WG ROMEX-2500'" },
  { vendor: "COP", catalog: "RX102WG1000", description: "10/2 WG ROMEX-1000'" },
  { vendor: "COP", catalog: "RX102WG2500", description: "10/2 WG ROMEX PINK-2500'" },
  { vendor: "COP", catalog: "RX102WG5000", description: "10/2 WG ROMEX-5000'" },
  { vendor: "COP", catalog: "RX103WG1000", description: "10/3 WG ROMEX ORANGE-1000'" },
  { vendor: "COP", catalog: "RX103WG2500", description: "10/3 WG ROMEX ORANGE-2500'" },
  { vendor: "COP", catalog: "RX103WG5000", description: "10/3 WG ROMEX-5000'" },
  { vendor: "COP", catalog: "SER30WG500", description: "CU 3/0-3/0-3/0-1/0 WG SER CABLE-500'" },
  { vendor: "COP", catalog: "TC1031000", description: "10/3 WOG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1041000", description: "10/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1042500", description: "10/4 TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC1231000", description: "12/3 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1241000", description: "12/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1242500", description: "12/4 TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC1421000", description: "14/2 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC142WOG1000", description: "14/2 WOG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1431000", description: "14/3 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1441000", description: "14/4 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC1451000", description: "14/5 TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC203WG500", description: "2/0-3WG TRAY CABLE 500" },
  { vendor: "COP", catalog: "TC203WG1000", description: "2/0-3WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC23WG500", description: "2/3 WG TRAY CABLE-500'" },
  { vendor: "COP", catalog: "TC23WG1000", description: "2/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC23WG2500", description: "2/3 WG TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC43WG1000", description: "4/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC63WG1000", description: "6/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC63WG2500", description: "6/3 WG TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC83WG1000", description: "8/3 WG TRAY CABLE-1000'" },
  { vendor: "COP", catalog: "TC83WG2500", description: "8/3 WG TRAY CABLE-2500'" },
  { vendor: "COP", catalog: "TC83WG500", description: "8/3 WG TRAY CABLE-500'" },
  { vendor: "COP", catalog: "THHN1BK500", description: "THHN 1 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN1BK1000", description: "THHN 1 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN1BK2500", description: "THHN 1 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN1BK5000", description: "THHN 1 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN1BL500", description: "THHN 1 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN1BL1000", description: "THHN 1 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN1BL2500", description: "THHN 1 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN1BL5000", description: "THHN 1 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN1GN500", description: "THHN 1 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN1GN1000", description: "THHN 1 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN1GN2500", description: "THHN 1 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN1GN5000", description: "THHN 1 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN1RD500", description: "THHN 1 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN1RD1000", description: "THHN 1 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN1RD2500", description: "THHN 1 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN1RD5000", description: "THHN 1 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN1GY500", description: "THHN 1 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN1GY1000", description: "THHN 1 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN1GY2500", description: "THHN 1 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN1GY5000", description: "THHN 1 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN1WH500", description: "THHN 1 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN1WH1000", description: "THHN 1 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN1WH2500", description: "THHN 1 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN1WH5000", description: "THHN 1 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN1OR500", description: "THHN 1 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN1OR1000", description: "THHN 1 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN1OR2500", description: "THHN 1 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN1OR5000", description: "THHN 1 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN1BR500", description: "THHN 1 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN1BR1000", description: "THHN 1 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN1BR2500", description: "THHN 1 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN1BR5000", description: "THHN 1 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN1PR500", description: "THHN 1 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN1PR1000", description: "THHN 1 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN1PR2500", description: "THHN 1 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN1PR5000", description: "THHN 1 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN1PK500", description: "THHN 1 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN1PK1000", description: "THHN 1 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN1PK2500", description: "THHN 1 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN1PK5000", description: "THHN 1 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN1YL500", description: "THHN 1 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN1YL1000", description: "THHN 1 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN1YL2500", description: "THHN 1 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN1YL5000", description: "THHN 1 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN2BK500", description: "THHN 2 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN2BK1000", description: "THHN 2 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN2BK2500", description: "THHN 2 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN2BK5000", description: "THHN 2 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN2BL500", description: "THHN 2 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN2BL1000", description: "THHN 2 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN2BL2500", description: "THHN 2 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN2BL5000", description: "THHN 2 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN2GN500", description: "THHN 2 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN2GN1000", description: "THHN 2 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN2GN2500", description: "THHN 2 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN2GN5000", description: "THHN 2 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN2RD500", description: "THHN 2 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN2RD1000", description: "THHN 2 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN2RD2500", description: "THHN 2 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN2RD5000", description: "THHN 2 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN2GY500", description: "THHN 2 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN2GY1000", description: "THHN 2 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN2GY2500", description: "THHN 2 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN2GY5000", description: "THHN 2 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN2WH500", description: "THHN 2 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN2WH1000", description: "THHN 2 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN2WH2500", description: "THHN 2 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN2WH5000", description: "THHN 2 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN2OR500", description: "THHN 2 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN2OR1000", description: "THHN 2 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN2OR2500", description: "THHN 2 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN2OR5000", description: "THHN 2 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN2BR500", description: "THHN 2 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN2BR1000", description: "THHN 2 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN2BR2500", description: "THHN 2 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN2BR5000", description: "THHN 2 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN2PR500", description: "THHN 2 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN2PR1000", description: "THHN 2 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN2PR2500", description: "THHN 2 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN2PR5000", description: "THHN 2 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN2PK500", description: "THHN 2 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN2PK1000", description: "THHN 2 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN2PK2500", description: "THHN 2 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN2PK5000", description: "THHN 2 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN2YL500", description: "THHN 2 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN2YL1000", description: "THHN 2 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN2YL2500", description: "THHN 2 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN2YL5000", description: "THHN 2 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN3BK500", description: "THHN 3 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN3BK1000", description: "THHN 3 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN3BK2500", description: "THHN 3 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN3BK5000", description: "THHN 3 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN3BL500", description: "THHN 3 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN3BL1000", description: "THHN 3 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN3BL2500", description: "THHN 3 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN3BL5000", description: "THHN 3 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN3GN500", description: "THHN 3 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN3GN1000", description: "THHN 3 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN3GN2500", description: "THHN 3 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN3GN5000", description: "THHN 3 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN3RD500", description: "THHN 3 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN3RD1000", description: "THHN 3 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN3RD2500", description: "THHN 3 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN3RD5000", description: "THHN 3 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN3GY500", description: "THHN 3 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN3GY1000", description: "THHN 3 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN3GY2500", description: "THHN 3 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN3GY5000", description: "THHN 3 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN3WH500", description: "THHN 3 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN3WH1000", description: "THHN 3 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN3WH2500", description: "THHN 3 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN3WH5000", description: "THHN 3 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN3OR500", description: "THHN 3 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN3OR1000", description: "THHN 3 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN3OR2500", description: "THHN 3 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN3OR5000", description: "THHN 3 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN3BR500", description: "THHN 3 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN3BR1000", description: "THHN 3 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN3BR2500", description: "THHN 3 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN3BR5000", description: "THHN 3 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN3PR500", description: "THHN 3 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN3PR1000", description: "THHN 3 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN3PR2500", description: "THHN 3 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN3PR5000", description: "THHN 3 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN3PK500", description: "THHN 3 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN3PK1000", description: "THHN 3 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN3PK2500", description: "THHN 3 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN3PK5000", description: "THHN 3 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN3YL500", description: "THHN 3 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN3YL1000", description: "THHN 3 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN3YL2500", description: "THHN 3 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN3YL5000", description: "THHN 3 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN4BK500", description: "THHN 4 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN4BK1000", description: "THHN 4 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN4BK2500", description: "THHN 4 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN4BK5000", description: "THHN 4 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN4BL500", description: "THHN 4 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN4BL1000", description: "THHN 4 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN4BL2500", description: "THHN 4 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN4BL5000", description: "THHN 4 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN4GN500", description: "THHN 4 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN4GN1000", description: "THHN 4 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN4GN2500", description: "THHN 4 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN4GN5000", description: "THHN 4 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN4RD500", description: "THHN 4 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN4RD1000", description: "THHN 4 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN4RD2500", description: "THHN 4 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN4RD5000", description: "THHN 4 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN4GY500", description: "THHN 4 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN4GY1000", description: "THHN 4 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN4GY2500", description: "THHN 4 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN4GY5000", description: "THHN 4 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN4WH500", description: "THHN 4 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN4WH1000", description: "THHN 4 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN4WH2500", description: "THHN 4 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN4WH5000", description: "THHN 4 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN4OR500", description: "THHN 4 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN4OR1000", description: "THHN 4 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN4OR2500", description: "THHN 4 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN4OR5000", description: "THHN 4 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN4BR500", description: "THHN 4 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN4BR1000", description: "THHN 4 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN4BR2500", description: "THHN 4 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN4BR5000", description: "THHN 4 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN4PR500", description: "THHN 4 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN4PR1000", description: "THHN 4 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN4PR2500", description: "THHN 4 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN4PR5000", description: "THHN 4 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN4PK500", description: "THHN 4 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN4PK1000", description: "THHN 4 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN4PK2500", description: "THHN 4 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN4PK5000", description: "THHN 4 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN4YL500", description: "THHN 4 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN4YL1000", description: "THHN 4 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN4YL2500", description: "THHN 4 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN4YL5000", description: "THHN 4 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN6BK500", description: "THHN 6 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN6BK1000", description: "THHN 6 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN6BK2500", description: "THHN 6 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN6BK5000", description: "THHN 6 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN6BL500", description: "THHN 6 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN6BL1000", description: "THHN 6 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN6BL2500", description: "THHN 6 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN6BL5000", description: "THHN 6 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN6GN500", description: "THHN 6 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN6GN1000", description: "THHN 6 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN6GN2500", description: "THHN 6 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN6GN5000", description: "THHN 6 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN6RD500", description: "THHN 6 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN6RD1000", description: "THHN 6 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN6RD2500", description: "THHN 6 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN6RD5000", description: "THHN 6 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN6GY500", description: "THHN 6 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN6GY1000", description: "THHN 6 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN6GY2500", description: "THHN 6 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN6GY5000", description: "THHN 6 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN6WH500", description: "THHN 6 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN6WH1000", description: "THHN 6 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN6WH2500", description: "THHN 6 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN6WH5000", description: "THHN 6 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN6OR500", description: "THHN 6 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN6OR1000", description: "THHN 6 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN6OR2500", description: "THHN 6 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN6OR5000", description: "THHN 6 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN6BR500", description: "THHN 6 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN6BR1000", description: "THHN 6 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN6BR2500", description: "THHN 6 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN6BR5000", description: "THHN 6 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN6PR500", description: "THHN 6 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN6PR1000", description: "THHN 6 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN6PR2500", description: "THHN 6 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN6PR5000", description: "THHN 6 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN6PK500", description: "THHN 6 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN6PK1000", description: "THHN 6 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN6PK2500", description: "THHN 6 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN6PK5000", description: "THHN 6 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN6YL500", description: "THHN 6 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN6YL1000", description: "THHN 6 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN6YL2500", description: "THHN 6 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN6YL5000", description: "THHN 6 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN8BK500", description: "THHN 8 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN8BK1000", description: "THHN 8 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN8BK2500", description: "THHN 8 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN8BK5000", description: "THHN 8 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN8BL500", description: "THHN 8 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN8BL1000", description: "THHN 8 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN8BL2500", description: "THHN 8 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN8BL5000", description: "THHN 8 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN8GN500", description: "THHN 8 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN8GN1000", description: "THHN 8 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN8GN2500", description: "THHN 8 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN8GN5000", description: "THHN 8 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN8RD500", description: "THHN 8 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN8RD1000", description: "THHN 8 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN8RD2500", description: "THHN 8 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN8RD5000", description: "THHN 8 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN8GY500", description: "THHN 8 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN8GY1000", description: "THHN 8 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN8GY2500", description: "THHN 8 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN8GY5000", description: "THHN 8 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN8WH500", description: "THHN 8 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN8WH1000", description: "THHN 8 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN8WH2500", description: "THHN 8 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN8WH5000", description: "THHN 8 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN8OR500", description: "THHN 8 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN8OR1000", description: "THHN 8 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN8OR2500", description: "THHN 8 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN8OR5000", description: "THHN 8 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN8BR500", description: "THHN 8 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN8BR1000", description: "THHN 8 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN8BR2500", description: "THHN 8 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN8BR5000", description: "THHN 8 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN8PR500", description: "THHN 8 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN8PR1000", description: "THHN 8 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN8PR2500", description: "THHN 8 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN8PR5000", description: "THHN 8 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN8PK500", description: "THHN 8 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN8PK1000", description: "THHN 8 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN8PK2500", description: "THHN 8 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN8PK5000", description: "THHN 8 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN8YL500", description: "THHN 8 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN8YL1000", description: "THHN 8 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN8YL2500", description: "THHN 8 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN8YL5000", description: "THHN 8 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN10BK500", description: "THHN 1/0 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN10BK1000", description: "THHN 1/0 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN10BK2500", description: "THHN 1/0 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN10BK5000", description: "THHN 1/0 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN10BL500", description: "THHN 1/0 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN10BL1000", description: "THHN 1/0 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN10BL2500", description: "THHN 1/0 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN10BL5000", description: "THHN 1/0 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN10GN500", description: "THHN 1/0 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN10GN1000", description: "THHN 1/0 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN10GN2500", description: "THHN 1/0 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN10GN5000", description: "THHN 1/0 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN10RD500", description: "THHN 1/0 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN10RD1000", description: "THHN 1/0 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN10RD2500", description: "THHN 1/0 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN10RD5000", description: "THHN 1/0 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN10GY500", description: "THHN 1/0 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN10GY1000", description: "THHN 1/0 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN10GY2500", description: "THHN 1/0 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN10GY5000", description: "THHN 1/0 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN10WH500", description: "THHN 1/0 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN10WH1000", description: "THHN 1/0 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN10WH2500", description: "THHN 1/0 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN10WH5000", description: "THHN 1/0 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN10OR500", description: "THHN 1/0 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN10OR1000", description: "THHN 1/0 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN10OR2500", description: "THHN 1/0 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN10OR5000", description: "THHN 1/0 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN10BR500", description: "THHN 1/0 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN10BR1000", description: "THHN 1/0 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN10BR2500", description: "THHN 1/0 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN10BR5000", description: "THHN 1/0 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN10PR500", description: "THHN 1/0 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN10PR1000", description: "THHN 1/0 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN10PR2500", description: "THHN 1/0 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN10PR5000", description: "THHN 1/0 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN10PK500", description: "THHN 1/0 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN10PK1000", description: "THHN 1/0 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN10PK2500", description: "THHN 1/0 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN10PK5000", description: "THHN 1/0 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN10YL500", description: "THHN 1/0 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN10YL1000", description: "THHN 1/0 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN10YL2500", description: "THHN 1/0 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN10YL5000", description: "THHN 1/0 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN20BK500", description: "THHN 2/0 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN20BK1000", description: "THHN 2/0 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN20BK2500", description: "THHN 2/0 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN20BK5000", description: "THHN 2/0 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN20BL500", description: "THHN 2/0 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN20BL1000", description: "THHN 2/0 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN20BL2500", description: "THHN 2/0 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN20BL5000", description: "THHN 2/0 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN20GN500", description: "THHN 2/0 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN20GN1000", description: "THHN 2/0 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN20GN2500", description: "THHN 2/0 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN20GN5000", description: "THHN 2/0 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN20RD500", description: "THHN 2/0 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN20RD1000", description: "THHN 2/0 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN20RD2500", description: "THHN 2/0 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN20RD5000", description: "THHN 2/0 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN20GY500", description: "THHN 2/0 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN20GY1000", description: "THHN 2/0 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN20GY2500", description: "THHN 2/0 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN20GY5000", description: "THHN 2/0 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN20WH500", description: "THHN 2/0 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN20WH1000", description: "THHN 2/0 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN20WH2500", description: "THHN 2/0 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN20WH5000", description: "THHN 2/0 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN20OR500", description: "THHN 2/0 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN20OR1000", description: "THHN 2/0 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN20OR2500", description: "THHN 2/0 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN20OR5000", description: "THHN 2/0 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN20BR500", description: "THHN 2/0 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN20BR1000", description: "THHN 2/0 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN20BR2500", description: "THHN 2/0 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN20BR5000", description: "THHN 2/0 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN20PR500", description: "THHN 2/0 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN20PR1000", description: "THHN 2/0 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN20PR2500", description: "THHN 2/0 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN20PR5000", description: "THHN 2/0 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN20PK500", description: "THHN 2/0 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN20PK1000", description: "THHN 2/0 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN20PK2500", description: "THHN 2/0 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN20PK5000", description: "THHN 2/0 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN20YL500", description: "THHN 2/0 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN20YL1000", description: "THHN 2/0 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN20YL2500", description: "THHN 2/0 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN20YL5000", description: "THHN 2/0 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN30BK500", description: "THHN 3/0 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN30BK1000", description: "THHN 3/0 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN30BK2500", description: "THHN 3/0 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN30BK5000", description: "THHN 3/0 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN30BL500", description: "THHN 3/0 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN30BL1000", description: "THHN 3/0 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN30BL2500", description: "THHN 3/0 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN30BL5000", description: "THHN 3/0 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN30GN500", description: "THHN 3/0 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN30GN1000", description: "THHN 3/0 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN30GN2500", description: "THHN 3/0 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN30GN5000", description: "THHN 3/0 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN30RD500", description: "THHN 3/0 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN30RD1000", description: "THHN 3/0 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN30RD2500", description: "THHN 3/0 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN30RD5000", description: "THHN 3/0 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN30GY500", description: "THHN 3/0 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN30GY1000", description: "THHN 3/0 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN30GY2500", description: "THHN 3/0 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN30GY5000", description: "THHN 3/0 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN30WH500", description: "THHN 3/0 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN30WH1000", description: "THHN 3/0 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN30WH2500", description: "THHN 3/0 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN30WH5000", description: "THHN 3/0 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN30OR500", description: "THHN 3/0 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN30OR1000", description: "THHN 3/0 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN30OR2500", description: "THHN 3/0 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN30OR5000", description: "THHN 3/0 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN30BR500", description: "THHN 3/0 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN30BR1000", description: "THHN 3/0 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN30BR2500", description: "THHN 3/0 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN30BR5000", description: "THHN 3/0 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN30PR500", description: "THHN 3/0 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN30PR1000", description: "THHN 3/0 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN30PR2500", description: "THHN 3/0 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN30PR5000", description: "THHN 3/0 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN30PK500", description: "THHN 3/0 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN30PK1000", description: "THHN 3/0 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN30PK2500", description: "THHN 3/0 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN30PK5000", description: "THHN 3/0 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN30YL500", description: "THHN 3/0 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN30YL1000", description: "THHN 3/0 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN30YL2500", description: "THHN 3/0 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN30YL5000", description: "THHN 3/0 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN40BK500", description: "THHN 4/0 AWG STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN40BK1000", description: "THHN 4/0 AWG STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN40BK2500", description: "THHN 4/0 AWG STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN40BK5000", description: "THHN 4/0 AWG STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN40BL500", description: "THHN 4/0 AWG STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN40BL1000", description: "THHN 4/0 AWG STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN40BL2500", description: "THHN 4/0 AWG STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN40BL5000", description: "THHN 4/0 AWG STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN40GN500", description: "THHN 4/0 AWG STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN40GN1000", description: "THHN 4/0 AWG STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN40GN2500", description: "THHN 4/0 AWG STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN40GN5000", description: "THHN 4/0 AWG STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN40RD500", description: "THHN 4/0 AWG STR RED 500'" },
  { vendor: "COP", catalog: "THHN40RD1000", description: "THHN 4/0 AWG STR RED 1000'" },
  { vendor: "COP", catalog: "THHN40RD2500", description: "THHN 4/0 AWG STR RED 2500'" },
  { vendor: "COP", catalog: "THHN40RD5000", description: "THHN 4/0 AWG STR RED 5000'" },
  { vendor: "COP", catalog: "THHN40GY500", description: "THHN 4/0 AWG STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN40GY1000", description: "THHN 4/0 AWG STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN40GY2500", description: "THHN 4/0 AWG STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN40GY5000", description: "THHN 4/0 AWG STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN40WH500", description: "THHN 4/0 AWG STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN40WH1000", description: "THHN 4/0 AWG STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN40WH2500", description: "THHN 4/0 AWG STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN40WH5000", description: "THHN 4/0 AWG STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN40OR500", description: "THHN 4/0 AWG STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN40OR1000", description: "THHN 4/0 AWG STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN40OR2500", description: "THHN 4/0 AWG STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN40OR5000", description: "THHN 4/0 AWG STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN40BR500", description: "THHN 4/0 AWG STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN40BR1000", description: "THHN 4/0 AWG STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN40BR2500", description: "THHN 4/0 AWG STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN40BR5000", description: "THHN 4/0 AWG STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN40PR500", description: "THHN 4/0 AWG STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN40PR1000", description: "THHN 4/0 AWG STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN40PR2500", description: "THHN 4/0 AWG STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN40PR5000", description: "THHN 4/0 AWG STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN40PK500", description: "THHN 4/0 AWG STR PINK 500'" },
  { vendor: "COP", catalog: "THHN40PK1000", description: "THHN 4/0 AWG STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN40PK2500", description: "THHN 4/0 AWG STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN40PK5000", description: "THHN 4/0 AWG STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN40YL500", description: "THHN 4/0 AWG STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN40YL1000", description: "THHN 4/0 AWG STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN40YL2500", description: "THHN 4/0 AWG STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN40YL5000", description: "THHN 4/0 AWG STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN250BK500", description: "THHN 250 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN250BK1000", description: "THHN 250 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN250BK2500", description: "THHN 250 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN250BK5000", description: "THHN 250 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN250BL500", description: "THHN 250 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN250BL1000", description: "THHN 250 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN250BL2500", description: "THHN 250 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN250BL5000", description: "THHN 250 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN250GN500", description: "THHN 250 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN250GN1000", description: "THHN 250 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN250GN2500", description: "THHN 250 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN250GN5000", description: "THHN 250 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN250RD500", description: "THHN 250 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN250RD1000", description: "THHN 250 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN250RD2500", description: "THHN 250 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN250RD5000", description: "THHN 250 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN250GY500", description: "THHN 250 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN250GY1000", description: "THHN 250 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN250GY2500", description: "THHN 250 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN250GY5000", description: "THHN 250 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN250WH500", description: "THHN 250 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN250WH1000", description: "THHN 250 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN250WH2500", description: "THHN 250 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN250WH5000", description: "THHN 250 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN250OR500", description: "THHN 250 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN250OR1000", description: "THHN 250 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN250OR2500", description: "THHN 250 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN250OR5000", description: "THHN 250 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN250BR500", description: "THHN 250 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN250BR1000", description: "THHN 250 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN250BR2500", description: "THHN 250 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN250BR5000", description: "THHN 250 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN250PR500", description: "THHN 250 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN250PR1000", description: "THHN 250 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN250PR2500", description: "THHN 250 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN250PR5000", description: "THHN 250 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN250PK500", description: "THHN 250 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN250PK1000", description: "THHN 250 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN250PK2500", description: "THHN 250 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN250PK5000", description: "THHN 250 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN250YL500", description: "THHN 250 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN250YL1000", description: "THHN 250 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN250YL2500", description: "THHN 250 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN250YL5000", description: "THHN 250 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN300BK500", description: "THHN 300 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN300BK1000", description: "THHN 300 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN300BK2500", description: "THHN 300 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN300BK5000", description: "THHN 300 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN300BL500", description: "THHN 300 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN300BL1000", description: "THHN 300 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN300BL2500", description: "THHN 300 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN300BL5000", description: "THHN 300 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN300GN500", description: "THHN 300 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN300GN1000", description: "THHN 300 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN300GN2500", description: "THHN 300 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN300GN5000", description: "THHN 300 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN300RD500", description: "THHN 300 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN300RD1000", description: "THHN 300 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN300RD2500", description: "THHN 300 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN300RD5000", description: "THHN 300 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN300GY500", description: "THHN 300 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN300GY1000", description: "THHN 300 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN300GY2500", description: "THHN 300 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN300GY5000", description: "THHN 300 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN300WH500", description: "THHN 300 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN300WH1000", description: "THHN 300 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN300WH2500", description: "THHN 300 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN300WH5000", description: "THHN 300 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN300OR500", description: "THHN 300 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN300OR1000", description: "THHN 300 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN300OR2500", description: "THHN 300 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN300OR5000", description: "THHN 300 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN300BR500", description: "THHN 300 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN300BR1000", description: "THHN 300 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN300BR2500", description: "THHN 300 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN300BR5000", description: "THHN 300 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN300PR500", description: "THHN 300 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN300PR1000", description: "THHN 300 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN300PR2500", description: "THHN 300 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN300PR5000", description: "THHN 300 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN300PK500", description: "THHN 300 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN300PK1000", description: "THHN 300 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN300PK2500", description: "THHN 300 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN300PK5000", description: "THHN 300 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN300YL500", description: "THHN 300 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN300YL1000", description: "THHN 300 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN300YL2500", description: "THHN 300 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN300YL5000", description: "THHN 300 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN350BK500", description: "THHN 350 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN350BK1000", description: "THHN 350 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN350BK2500", description: "THHN 350 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN350BK5000", description: "THHN 350 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN350BL500", description: "THHN 350 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN350BL1000", description: "THHN 350 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN350BL2500", description: "THHN 350 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN350BL5000", description: "THHN 350 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN350GN500", description: "THHN 350 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN350GN1000", description: "THHN 350 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN350GN2500", description: "THHN 350 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN350GN5000", description: "THHN 350 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN350RD500", description: "THHN 350 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN350RD1000", description: "THHN 350 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN350RD2500", description: "THHN 350 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN350RD5000", description: "THHN 350 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN350GY500", description: "THHN 350 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN350GY1000", description: "THHN 350 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN350GY2500", description: "THHN 350 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN350GY5000", description: "THHN 350 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN350WH500", description: "THHN 350 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN350WH1000", description: "THHN 350 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN350WH2500", description: "THHN 350 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN350WH5000", description: "THHN 350 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN350OR500", description: "THHN 350 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN350OR1000", description: "THHN 350 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN350OR2500", description: "THHN 350 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN350OR5000", description: "THHN 350 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN350BR500", description: "THHN 350 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN350BR1000", description: "THHN 350 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN350BR2500", description: "THHN 350 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN350BR5000", description: "THHN 350 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN350PR500", description: "THHN 350 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN350PR1000", description: "THHN 350 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN350PR2500", description: "THHN 350 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN350PR5000", description: "THHN 350 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN350PK500", description: "THHN 350 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN350PK1000", description: "THHN 350 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN350PK2500", description: "THHN 350 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN350PK5000", description: "THHN 350 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN350YL500", description: "THHN 350 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN350YL1000", description: "THHN 350 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN350YL2500", description: "THHN 350 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN350YL5000", description: "THHN 350 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN400BK500", description: "THHN 400 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN400BK1000", description: "THHN 400 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN400BK2500", description: "THHN 400 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN400BK5000", description: "THHN 400 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN400BL500", description: "THHN 400 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN400BL1000", description: "THHN 400 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN400BL2500", description: "THHN 400 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN400BL5000", description: "THHN 400 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN400GN500", description: "THHN 400 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN400GN1000", description: "THHN 400 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN400GN2500", description: "THHN 400 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN400GN5000", description: "THHN 400 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN400RD500", description: "THHN 400 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN400RD1000", description: "THHN 400 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN400RD2500", description: "THHN 400 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN400RD5000", description: "THHN 400 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN400GY500", description: "THHN 400 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN400GY1000", description: "THHN 400 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN400GY2500", description: "THHN 400 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN400GY5000", description: "THHN 400 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN400WH500", description: "THHN 400 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN400WH1000", description: "THHN 400 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN400WH2500", description: "THHN 400 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN400WH5000", description: "THHN 400 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN400OR500", description: "THHN 400 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN400OR1000", description: "THHN 400 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN400OR2500", description: "THHN 400 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN400OR5000", description: "THHN 400 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN400BR500", description: "THHN 400 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN400BR1000", description: "THHN 400 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN400BR2500", description: "THHN 400 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN400BR5000", description: "THHN 400 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN400PR500", description: "THHN 400 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN400PR1000", description: "THHN 400 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN400PR2500", description: "THHN 400 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN400PR5000", description: "THHN 400 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN400PK500", description: "THHN 400 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN400PK1000", description: "THHN 400 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN400PK2500", description: "THHN 400 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN400PK5000", description: "THHN 400 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN400YL500", description: "THHN 400 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN400YL1000", description: "THHN 400 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN400YL2500", description: "THHN 400 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN400YL5000", description: "THHN 400 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN500BK500", description: "THHN 500 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN500BK1000", description: "THHN 500 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN500BK2500", description: "THHN 500 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN500BK5000", description: "THHN 500 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN500BL500", description: "THHN 500 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN500BL1000", description: "THHN 500 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN500BL2500", description: "THHN 500 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN500BL5000", description: "THHN 500 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN500GN500", description: "THHN 500 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN500GN1000", description: "THHN 500 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN500GN2500", description: "THHN 500 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN500GN5000", description: "THHN 500 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN500RD500", description: "THHN 500 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN500RD1000", description: "THHN 500 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN500RD2500", description: "THHN 500 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN500RD5000", description: "THHN 500 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN500GY500", description: "THHN 500 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN500GY1000", description: "THHN 500 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN500GY2500", description: "THHN 500 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN500GY5000", description: "THHN 500 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN500WH500", description: "THHN 500 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN500WH1000", description: "THHN 500 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN500WH2500", description: "THHN 500 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN500WH5000", description: "THHN 500 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN500OR500", description: "THHN 500 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN500OR1000", description: "THHN 500 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN500OR2500", description: "THHN 500 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN500OR5000", description: "THHN 500 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN500BR500", description: "THHN 500 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN500BR1000", description: "THHN 500 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN500BR2500", description: "THHN 500 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN500BR5000", description: "THHN 500 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN500PR500", description: "THHN 500 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN500PR1000", description: "THHN 500 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN500PR2500", description: "THHN 500 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN500PR5000", description: "THHN 500 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN500PK500", description: "THHN 500 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN500PK1000", description: "THHN 500 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN500PK2500", description: "THHN 500 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN500PK5000", description: "THHN 500 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN500YL500", description: "THHN 500 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN500YL1000", description: "THHN 500 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN500YL2500", description: "THHN 500 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN500YL5000", description: "THHN 500 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN600BK500", description: "THHN 600 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN600BK1000", description: "THHN 600 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN600BK2000", description: "THHN 600 KCMIL STR BLACK 2000'" },
  { vendor: "COP", catalog: "THHN600BK2500", description: "THHN 600 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN600BK5000", description: "THHN 600 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN600BL500", description: "THHN 600 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN600BL1000", description: "THHN 600 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN600BL2000", description: "THHN 600 KCMIL STR BLUE 2000'" },
  { vendor: "COP", catalog: "THHN600BL2500", description: "THHN 600 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN600BL5000", description: "THHN 600 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN600GN500", description: "THHN 600 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN600GN1000", description: "THHN 600 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN600GN2000", description: "THHN 600 KCMIL STR GREEN 2000'" },
  { vendor: "COP", catalog: "THHN600GN2500", description: "THHN 600 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN600GN5000", description: "THHN 600 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN600RD500", description: "THHN 600 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN600RD1000", description: "THHN 600 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN600RD2000", description: "THHN 600 KCMIL STR RED 2000'" },
  { vendor: "COP", catalog: "THHN600RD2500", description: "THHN 600 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN600RD5000", description: "THHN 600 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN600GY500", description: "THHN 600 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN600GY1000", description: "THHN 600 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN600GY2000", description: "THHN 600 KCMIL STR GRAY 2000'" },
  { vendor: "COP", catalog: "THHN600GY2500", description: "THHN 600 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN600GY5000", description: "THHN 600 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN600WH500", description: "THHN 600 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN600WH1000", description: "THHN 600 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN600WH2000", description: "THHN 600 KCMIL STR WHITE 2000'" },
  { vendor: "COP", catalog: "THHN600WH2500", description: "THHN 600 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN600WH5000", description: "THHN 600 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN600OR500", description: "THHN 600 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN600OR1000", description: "THHN 600 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN600OR2000", description: "THHN 600 KCMIL STR ORANGE 2000'" },
  { vendor: "COP", catalog: "THHN600OR2500", description: "THHN 600 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN600OR5000", description: "THHN 600 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN600BR500", description: "THHN 600 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN600BR1000", description: "THHN 600 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN600BR2000", description: "THHN 600 KCMIL STR BROWN 2000'" },
  { vendor: "COP", catalog: "THHN600BR2500", description: "THHN 600 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN600BR5000", description: "THHN 600 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN600PR500", description: "THHN 600 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN600PR1000", description: "THHN 600 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN600PR2000", description: "THHN 600 KCMIL STR PURPLE 2000'" },
  { vendor: "COP", catalog: "THHN600PR2500", description: "THHN 600 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN600PR5000", description: "THHN 600 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN600PK500", description: "THHN 600 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN600PK1000", description: "THHN 600 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN600PK2000", description: "THHN 600 KCMIL STR PINK 2000'" },
  { vendor: "COP", catalog: "THHN600PK2500", description: "THHN 600 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN600PK5000", description: "THHN 600 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN600YL500", description: "THHN 600 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN600YL1000", description: "THHN 600 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN600YL2000", description: "THHN 600 KCMIL STR YELLOW 2000'" },
  { vendor: "COP", catalog: "THHN600YL2500", description: "THHN 600 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN600YL5000", description: "THHN 600 KCMIL STR YELLOW 5000'" },
  { vendor: "COP", catalog: "THHN750BK500", description: "THHN 750 KCMIL STR BLACK 500'" },
  { vendor: "COP", catalog: "THHN750BK1000", description: "THHN 750 KCMIL STR BLACK 1000'" },
  { vendor: "COP", catalog: "THHN750BK2000", description: "THHN 750 KCMIL STR BLACK 2000'" },
  { vendor: "COP", catalog: "THHN750BK2500", description: "THHN 750 KCMIL STR BLACK 2500'" },
  { vendor: "COP", catalog: "THHN750BK5000", description: "THHN 750 KCMIL STR BLACK 5000'" },
  { vendor: "COP", catalog: "THHN750BL500", description: "THHN 750 KCMIL STR BLUE 500'" },
  { vendor: "COP", catalog: "THHN750BL1000", description: "THHN 750 KCMIL STR BLUE 1000'" },
  { vendor: "COP", catalog: "THHN750BL2000", description: "THHN 750 KCMIL STR BLUE 2000'" },
  { vendor: "COP", catalog: "THHN750BL2500", description: "THHN 750 KCMIL STR BLUE 2500'" },
  { vendor: "COP", catalog: "THHN750BL5000", description: "THHN 750 KCMIL STR BLUE 5000'" },
  { vendor: "COP", catalog: "THHN750GN500", description: "THHN 750 KCMIL STR GREEN 500'" },
  { vendor: "COP", catalog: "THHN750GN1000", description: "THHN 750 KCMIL STR GREEN 1000'" },
  { vendor: "COP", catalog: "THHN750GN2000", description: "THHN 750 KCMIL STR GREEN 2000'" },
  { vendor: "COP", catalog: "THHN750GN2500", description: "THHN 750 KCMIL STR GREEN 2500'" },
  { vendor: "COP", catalog: "THHN750GN5000", description: "THHN 750 KCMIL STR GREEN 5000'" },
  { vendor: "COP", catalog: "THHN750RD500", description: "THHN 750 KCMIL STR RED 500'" },
  { vendor: "COP", catalog: "THHN750RD1000", description: "THHN 750 KCMIL STR RED 1000'" },
  { vendor: "COP", catalog: "THHN750RD2000", description: "THHN 750 KCMIL STR RED 2000'" },
  { vendor: "COP", catalog: "THHN750RD2500", description: "THHN 750 KCMIL STR RED 2500'" },
  { vendor: "COP", catalog: "THHN750RD5000", description: "THHN 750 KCMIL STR RED 5000'" },
  { vendor: "COP", catalog: "THHN750GY500", description: "THHN 750 KCMIL STR GRAY 500'" },
  { vendor: "COP", catalog: "THHN750GY1000", description: "THHN 750 KCMIL STR GRAY 1000'" },
  { vendor: "COP", catalog: "THHN750GY2000", description: "THHN 750 KCMIL STR GRAY 2000'" },
  { vendor: "COP", catalog: "THHN750GY2500", description: "THHN 750 KCMIL STR GRAY 2500'" },
  { vendor: "COP", catalog: "THHN750GY5000", description: "THHN 750 KCMIL STR GRAY 5000'" },
  { vendor: "COP", catalog: "THHN750WH500", description: "THHN 750 KCMIL STR WHITE 500'" },
  { vendor: "COP", catalog: "THHN750WH1000", description: "THHN 750 KCMIL STR WHITE 1000'" },
  { vendor: "COP", catalog: "THHN750WH2000", description: "THHN 750 KCMIL STR WHITE 2000'" },
  { vendor: "COP", catalog: "THHN750WH2500", description: "THHN 750 KCMIL STR WHITE 2500'" },
  { vendor: "COP", catalog: "THHN750WH5000", description: "THHN 750 KCMIL STR WHITE 5000'" },
  { vendor: "COP", catalog: "THHN750OR500", description: "THHN 750 KCMIL STR ORANGE 500'" },
  { vendor: "COP", catalog: "THHN750OR1000", description: "THHN 750 KCMIL STR ORANGE 1000'" },
  { vendor: "COP", catalog: "THHN750OR2000", description: "THHN 750 KCMIL STR ORANGE 2000'" },
  { vendor: "COP", catalog: "THHN750OR2500", description: "THHN 750 KCMIL STR ORANGE 2500'" },
  { vendor: "COP", catalog: "THHN750OR5000", description: "THHN 750 KCMIL STR ORANGE 5000'" },
  { vendor: "COP", catalog: "THHN750BR500", description: "THHN 750 KCMIL STR BROWN 500'" },
  { vendor: "COP", catalog: "THHN750BR1000", description: "THHN 750 KCMIL STR BROWN 1000'" },
  { vendor: "COP", catalog: "THHN750BR2000", description: "THHN 750 KCMIL STR BROWN 2000'" },
  { vendor: "COP", catalog: "THHN750BR2500", description: "THHN 750 KCMIL STR BROWN 2500'" },
  { vendor: "COP", catalog: "THHN750BR5000", description: "THHN 750 KCMIL STR BROWN 5000'" },
  { vendor: "COP", catalog: "THHN750PR500", description: "THHN 750 KCMIL STR PURPLE 500'" },
  { vendor: "COP", catalog: "THHN750PR1000", description: "THHN 750 KCMIL STR PURPLE 1000'" },
  { vendor: "COP", catalog: "THHN750PR2000", description: "THHN 750 KCMIL STR PURPLE 2000'" },
  { vendor: "COP", catalog: "THHN750PR2500", description: "THHN 750 KCMIL STR PURPLE 2500'" },
  { vendor: "COP", catalog: "THHN750PR5000", description: "THHN 750 KCMIL STR PURPLE 5000'" },
  { vendor: "COP", catalog: "THHN750PK500", description: "THHN 750 KCMIL STR PINK 500'" },
  { vendor: "COP", catalog: "THHN750PK1000", description: "THHN 750 KCMIL STR PINK 1000'" },
  { vendor: "COP", catalog: "THHN750PK2000", description: "THHN 750 KCMIL STR PINK 2000'" },
  { vendor: "COP", catalog: "THHN750PK2500", description: "THHN 750 KCMIL STR PINK 2500'" },
  { vendor: "COP", catalog: "THHN750PK5000", description: "THHN 750 KCMIL STR PINK 5000'" },
  { vendor: "COP", catalog: "THHN750YL500", description: "THHN 750 KCMIL STR YELLOW 500'" },
  { vendor: "COP", catalog: "THHN750YL1000", description: "THHN 750 KCMIL STR YELLOW 1000'" },
  { vendor: "COP", catalog: "THHN750YL2000", description: "THHN 750 KCMIL STR YELLOW 2000'" },
  { vendor: "COP", catalog: "THHN750YL2500", description: "THHN 750 KCMIL STR YELLOW 2500'" },
  { vendor: "COP", catalog: "THHN750YL5000", description: "THHN 750 KCMIL STR YELLOW 5000'" },
];

export const PARSED_CATALOG: ParsedCatalogEntry[] = CATALOG.map(parseCatalogEntry);

function dedup(entries: ParsedCatalogEntry[]): ParsedCatalogEntry[] {
  const seen = new Set<string>();
  return entries.filter(e => {
    const key = `${e.vendor}|${e.catalog}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function commonPrefixLen(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function sortPrefix(entries: ParsedCatalogEntry[], upper: string): ParsedCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const prefA = commonPrefixLen(a.catalog, upper);
    const prefB = commonPrefixLen(b.catalog, upper);
    if (prefB !== prefA) return prefB - prefA;
    return a.catalog < b.catalog ? -1 : a.catalog > b.catalog ? 1 : 0;
  });
}

function sortContains(entries: ParsedCatalogEntry[], upper: string): ParsedCatalogEntry[] {
  return [...entries].sort((a, b) => {
    const posA = a.catalog.indexOf(upper);
    const posB = b.catalog.indexOf(upper);
    const adjPosA = posA === -1 ? 9999 : posA;
    const adjPosB = posB === -1 ? 9999 : posB;
    if (adjPosA !== adjPosB) return adjPosA - adjPosB;
    if (a.catalog.length !== b.catalog.length) return a.catalog.length - b.catalog.length;
    return a.catalog < b.catalog ? -1 : a.catalog > b.catalog ? 1 : 0;
  });
}

export function lookupCatalog(query: string, userCatalog?: ParsedCatalogEntry[]): ParsedCatalogEntry[] {
  if (!query || query.length < 2) return [];
  const upper = query.toUpperCase().replace(/[^A-Z0-9]/g, "");

  const combined = userCatalog && userCatalog.length > 0
    ? [...userCatalog, ...PARSED_CATALOG]
    : PARSED_CATALOG;

  const sortedAliasPrefix = CATALOG_ALIASES
    .filter(a => a.alias.startsWith(upper))
    .sort((a, b) => {
      const prefA = commonPrefixLen(a.alias, upper);
      const prefB = commonPrefixLen(b.alias, upper);
      if (prefB !== prefA) return prefB - prefA;
      return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
    })
    .flatMap(a => {
      const real = combined.find(e => e.catalog === a.catalog && e.vendor === a.vendor);
      return real ? [{ ...real, aliasLabel: a.alias }] : [];
    });

  const sortedAliasContains = CATALOG_ALIASES
    .filter(a => !a.alias.startsWith(upper) && a.alias.includes(upper))
    .sort((a, b) => {
      const posA = a.alias.indexOf(upper);
      const posB = b.alias.indexOf(upper);
      if (posA !== posB) return posA - posB;
      if (a.alias.length !== b.alias.length) return a.alias.length - b.alias.length;
      return a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0;
    })
    .flatMap(a => {
      const real = combined.find(e => e.catalog === a.catalog && e.vendor === a.vendor);
      return real ? [{ ...real, aliasLabel: a.alias }] : [];
    });

  const aliasEntries = [...sortedAliasPrefix, ...sortedAliasContains];

  const exact = combined.filter(e => e.catalog === upper);
  if (exact.length > 0) return dedup([...aliasEntries, ...exact]);

  const prefix = sortPrefix(combined.filter(e => e.catalog.startsWith(upper)), upper);
  if (prefix.length > 0) return dedup([...aliasEntries, ...prefix]).slice(0, 15);

  const contains = sortContains(
    combined.filter(e => e.catalog.includes(upper) || e.description.toUpperCase().includes(upper)),
    upper,
  );
  return dedup([...aliasEntries, ...contains]).slice(0, 15);
}

export function userWireCatalogToParsedEntry(cat: {
  catalog: string;
  vendor: string;
  reelLength: number;
  description?: string | null;
  color?: string | null;
  jacketType?: string | null;
  conductors?: string | null;
  groundSize?: string | null;
  wireType?: string | null;
}): ParsedCatalogEntry {
  const parts: string[] = [];
  if (cat.description) parts.push(cat.description);
  if (cat.jacketType) parts.push(cat.jacketType);
  if (cat.groundSize) parts.push(`GND ${cat.groundSize}`);
  parts.push(`${cat.reelLength}'`);
  const description = parts.join(" ");
  return {
    vendor: cat.vendor.toUpperCase(),
    catalog: cat.catalog.toUpperCase().replace(/[^A-Z0-9]/g, ""),
    description,
    footage: cat.reelLength,
    color: cat.color || undefined,
    conductors: cat.conductors || undefined,
    wireType: cat.wireType || undefined,
  };
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

  let input = rawDetails.toUpperCase().replace(/[^A-Z0-9\-]/g, "");

  if (input === "MHF" || input.startsWith("MHF") && input.length <= 4) {
    input = "MHF40402041000";
  }

  const SPECIAL_ALIASES: Record<string, string> = {
    "25001XHHWALBR": "XHHW250BR1000",
    "25001XHHWALBN": "XHHW250BR1000",
    "25001XHHWALOR": "XHHW250OR1000",
  };
  if (SPECIAL_ALIASES[input]) {
    input = SPECIAL_ALIASES[input];
  }

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
  const NO_COLOR_TYPES = ["TC", "RX", "URD", "SER", "TRIPLEX", "UF", "ALF", "LT", "LTNM", "BARE"];
  const ONLY_BK_TYPES = ["SEOOW"];
  const skipColor = NO_COLOR_TYPES.includes(detectedType);

  let colorResult = !skipColor ? matchColor(remaining) : null;
  if (colorResult && ONLY_BK_TYPES.includes(detectedType) && colorResult.corrected !== "BK" && colorResult.original !== "BK") {
    colorResult = null;
  }
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

  if (parts.footage === "2000" && gaugeResult) {
    const currentGauge = gaugeResult.corrected || gaugeResult.original;
    if (currentGauge !== "600") {
      parts.gauge = { original: gaugeResult.original, corrected: "600", confident: true };
      correctedParts[1] = "600";
      wasModified = true;
    }
  }

  const correctedDetails = correctedParts.join("");

  const rebuiltCatalog = correctedDetails;
  const rebuiltMatch = CATALOG.find(e => e.catalog === rebuiltCatalog);
  if (rebuiltMatch) {
    return {
      correctedDetails,
      wasModified,
      confident: overallConfident,
      catalogMatch: rebuiltMatch,
      parts,
    };
  }

  return {
    correctedDetails,
    wasModified,
    confident: overallConfident,
    parts,
  };
}

function parseCodeParts(code: string): { type: string | null; gauge: string | null } {
  const typeMatch = code.match(/^([A-Z]+)/);
  if (!typeMatch) return { type: null, gauge: null };
  const typePart = typeMatch[1];
  const knownType = [...WIRE_TYPES].sort((a, b) => b.length - a.length).find(wt => typePart.startsWith(wt));
  if (!knownType) return { type: typePart, gauge: null };
  const afterType = code.slice(knownType.length);
  const gaugeMatch = afterType.match(/^(\d+(?:\/\d+)?)/);
  if (!gaugeMatch) return { type: knownType, gauge: null };
  const rawGauge = gaugeMatch[1];
  const knownGauge = (WIRE_GAUGES as readonly string[]).includes(rawGauge) ? rawGauge : null;
  return { type: knownType, gauge: knownGauge };
}

function matchCatalog(input: string): { entry: CatalogEntry; confident: boolean } | null {
  for (const entry of CATALOG) {
    if (entry.catalog === input) {
      return { entry, confident: true };
    }
  }

  const inputParsed = parseCodeParts(input);

  const maxDist = input.length >= 10 ? 2 : 1;
  let bestEntry: CatalogEntry | null = null;
  let bestDist = Infinity;
  let bestIsPrefix = false;
  for (const entry of CATALOG) {
    if (Math.abs(entry.catalog.length - input.length) > maxDist) continue;
    const dist = levenshtein(input, entry.catalog);
    if (dist > maxDist) continue;
    if (inputParsed.gauge) {
      const entryParsed = parseCodeParts(entry.catalog);
      if (entryParsed.gauge && entryParsed.gauge !== inputParsed.gauge) continue;
    }
    const isPrefix = entry.catalog.startsWith(input) || input.startsWith(entry.catalog);
    if (dist < bestDist || (dist === bestDist && isPrefix && !bestIsPrefix)) {
      bestDist = dist;
      bestEntry = entry;
      bestIsPrefix = isPrefix;
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

  const prefixMatch = s.match(/^([A-Z]+)(?=\d)/);
  if (prefixMatch && prefixMatch[1].length >= 2) {
    const prefix = prefixMatch[1];
    const NON_HEURISTIC = ["SJ", "SE", "MH", "LT", "UF", "TC", "RX", "BA"];
    const skip = NON_HEURISTIC.some(p => prefix.includes(p)) || prefix.includes("M");
    if (!skip) {
      if (prefix.includes("N")) {
        return { original: prefix, corrected: "THHN", confident: true };
      }
      if (prefix.includes("W")) {
        return { original: prefix, corrected: "XHHW", confident: true };
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

  if (s.length >= 2 && s[0] === "0" && s[1] === "R" && (s.length < 3 || s[2] !== "D")) {
    const fixed = "O" + s.slice(1);
    for (const c of COLOR_CODES) {
      if (fixed.startsWith(c)) {
        return { original: s.slice(0, c.length), corrected: c, confident: true };
      }
    }
  }

  if (s.length >= 1 && s[0] === "P") {
    if (s.length >= 2 && (s[1] === "R" || s[1] === "K")) {
      const code = s.slice(0, 2);
      if (COLOR_CODES.includes(code)) {
        return { original: code, corrected: code, confident: true };
      }
    } else {
      const fixed = "R" + s.slice(1);
      for (const c of COLOR_CODES) {
        if (fixed.startsWith(c)) {
          return { original: s.slice(0, c.length), corrected: c, confident: true };
        }
      }
    }
  }

  if (s.length >= 2) {
    const c1 = s[0], c2 = s[1];
    const FIRST_CHAR_SUBS: Record<string, { replacement: string; confident: boolean }> = {
      "8": { replacement: "B", confident: true },
      "6": { replacement: "G", confident: true },
      "V": { replacement: "Y", confident: false },
    };
    const SECOND_CHAR_SUBS: Record<string, { replacement: string; confident: boolean }> = {
      "1": { replacement: "L", confident: true },
      "I": { replacement: "L", confident: true },
      "H": { replacement: "N", confident: false },
      "N": { replacement: "H", confident: false },
      "0": { replacement: "D", confident: false },
    };

    const sub1 = FIRST_CHAR_SUBS[c1];
    if (sub1) {
      const candidate = sub1.replacement + c2;
      if (COLOR_CODES.includes(candidate)) {
        return { original: s.slice(0, 2), corrected: candidate, confident: sub1.confident };
      }
    }

    const sub2 = SECOND_CHAR_SUBS[c2];
    if (sub2) {
      const candidate = c1 + sub2.replacement;
      if (COLOR_CODES.includes(candidate)) {
        return { original: s.slice(0, 2), corrected: candidate, confident: sub2.confident };
      }
    }

    if (sub1 && sub2) {
      const candidate = sub1.replacement + sub2.replacement;
      if (COLOR_CODES.includes(candidate)) {
        return { original: s.slice(0, 2), corrected: candidate, confident: false };
      }
    }
  }

  if (s[0] === "K") {
    return { original: "K", corrected: "BK", confident: false };
  }

  return null;
}
