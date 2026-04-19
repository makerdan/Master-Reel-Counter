// NOTE: This file is intentionally duplicated in server/unit-conversion.ts.
// The conversion logic is needed on both the server (PDF/Excel export, stats
// aggregation) and the client (live display formatting). A shared module cannot
// be used directly because the server build and the Vite client build have
// separate module resolution contexts. Keep both files in sync manually when
// adding or changing conversion constants or helpers.

const FEET_PER_METER = 3.28084;
const METERS_PER_FOOT = 0.3048;

export type UnitType = "feet" | "meters";

export function toDisplayUnit(feetValue: number, unit: UnitType): number {
  if (unit === "meters") {
    return Math.round(feetValue * METERS_PER_FOOT);
  }
  return feetValue;
}

export function toBaseFeet(displayValue: number, unit: UnitType): number {
  if (unit === "meters") {
    return Math.round(displayValue * FEET_PER_METER);
  }
  return displayValue;
}

export function unitLabel(unit: UnitType): string {
  return unit === "meters" ? "m" : "ft";
}

export function unitLabelFull(unit: UnitType): string {
  return unit === "meters" ? "meters" : "feet";
}
