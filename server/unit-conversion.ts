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
