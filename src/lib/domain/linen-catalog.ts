/**
 * Catalogue de linge HALO par défaut (libellés traduits via linenItem.<clé>).
 * La conciergerie ajuste prix, règles, ou ajoute ses propres articles.
 */
import type { LinenType } from "./types";

export const DEFAULT_LINEN: Omit<LinenType, "id" | "name">[] = [
  { key: "fitted_90", category: "bed", rule: { kind: "per_bed", qtyBySize: { single: 1 } }, laundryCost: 1.1, purchaseCost: 14, active: true },
  { key: "fitted_140", category: "bed", rule: { kind: "per_bed", qtyBySize: { double: 1, sofa_bed: 1 } }, laundryCost: 1.4, purchaseCost: 18, active: true },
  { key: "fitted_160", category: "bed", rule: { kind: "per_bed", qtyBySize: { queen: 1 } }, laundryCost: 1.5, purchaseCost: 20, active: true },
  { key: "fitted_180", category: "bed", rule: { kind: "per_bed", qtyBySize: { king: 1 } }, laundryCost: 1.6, purchaseCost: 22, active: true },
  { key: "duvet_140", category: "bed", rule: { kind: "per_bed", qtyBySize: { single: 1 } }, laundryCost: 1.8, purchaseCost: 24, active: true },
  { key: "duvet_240", category: "bed", rule: { kind: "per_bed", qtyBySize: { double: 1, queen: 1, sofa_bed: 1 } }, laundryCost: 2.4, purchaseCost: 32, active: true },
  { key: "duvet_260", category: "bed", rule: { kind: "per_bed", qtyBySize: { king: 1 } }, laundryCost: 2.6, purchaseCost: 36, active: true },
  { key: "pillowcase", category: "bed", rule: { kind: "per_bed", qtyBySize: { single: 1, double: 2, queen: 2, king: 2, sofa_bed: 2 } }, laundryCost: 0.5, purchaseCost: 6, active: true },
  { key: "bath_towel", category: "bath", rule: { kind: "per_guest", qty: 1 }, laundryCost: 0.9, purchaseCost: 12, active: true },
  { key: "hand_towel", category: "bath", rule: { kind: "per_guest", qty: 1 }, laundryCost: 0.5, purchaseCost: 6, active: true },
  { key: "bath_mat", category: "bath", rule: { kind: "fixed", qty: 1 }, laundryCost: 0.6, purchaseCost: 8, active: true },
  { key: "tea_towel", category: "kitchen", rule: { kind: "fixed", qty: 2 }, laundryCost: 0.3, purchaseCost: 4, active: true },
  { key: "cot_sheet", category: "baby", rule: { kind: "per_baby", qty: 1 }, laundryCost: 0.6, purchaseCost: 9, active: true },
];
