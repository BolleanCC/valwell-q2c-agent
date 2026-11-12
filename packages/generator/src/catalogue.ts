import type { LineKind } from "@valwell/domain";

/** A catalogue entry with a whole-dollar range used to draw prices or costs. */
export interface CatalogueEntry {
  readonly itemCode: string;
  readonly description: string;
  readonly kind: LineKind;
  /** For services and labour: list price range. For parts: unit cost range. */
  readonly dollarRange: readonly [min: number, max: number];
}

/** Fixed-price shop services, priced from the customer's price book. */
export const SERVICES = [
  {
    itemCode: "TDI-FEE",
    description: "Teardown & inspection",
    kind: "SERVICE",
    dollarRange: [650, 950],
  },
  {
    itemCode: "HYDRO-TEST",
    description: "Hydrostatic shell & seat test",
    kind: "SERVICE",
    dollarRange: [300, 450],
  },
] as const satisfies readonly CatalogueEntry[];

/** Hourly labour, priced from the customer's price book. */
export const LABOUR = [
  {
    itemCode: "LAB-TECH",
    description: "Valve technician labour (per hour)",
    kind: "LABOUR",
    dollarRange: [85, 110],
  },
  {
    itemCode: "LAB-MACH",
    description: "Machining labour (per hour)",
    kind: "LABOUR",
    dollarRange: [115, 145],
  },
  {
    itemCode: "LAB-WELD",
    description: "Weld overlay labour (per hour)",
    kind: "LABOUR",
    dollarRange: [125, 160],
  },
] as const satisfies readonly CatalogueEntry[];

/** Replacement parts, billed cost-plus under the customer's markup cap. */
export const PARTS = [
  { itemCode: "PART-SEAT", description: "Seat ring", kind: "PART", dollarRange: [140, 260] },
  { itemCode: "PART-GATE", description: "Gate", kind: "PART", dollarRange: [600, 1100] },
  { itemCode: "PART-STEM", description: "Stem", kind: "PART", dollarRange: [320, 520] },
  { itemCode: "PART-SEALKIT", description: "Seal kit", kind: "PART", dollarRange: [90, 160] },
  { itemCode: "PART-GASKET", description: "Bonnet gasket", kind: "PART", dollarRange: [35, 70] },
  {
    itemCode: "PART-PACKING",
    description: "Stem packing set",
    kind: "PART",
    dollarRange: [60, 120],
  },
  { itemCode: "PART-BEARING", description: "Stem bearing", kind: "PART", dollarRange: [80, 150] },
] as const satisfies readonly CatalogueEntry[];

export const PRICE_BOOK_ENTRIES: readonly CatalogueEntry[] = [...SERVICES, ...LABOUR];
export const CATALOGUE: readonly CatalogueEntry[] = [...SERVICES, ...LABOUR, ...PARTS];

export const VALVE_MODELS = [
  '2-1/16" 5K gate valve',
  '3-1/16" 5K gate valve',
  '4-1/16" 10K gate valve',
  '3-1/16" 10K gate valve',
] as const;

/** Fictional operators; any resemblance to real companies is coincidental. */
export const CUSTOMER_NAMES = [
  "Prairie Basin Energy",
  "Northfork Resources",
  "Kestrel Petroleum",
  "Red Deer Midstream",
  "Athabasca Ridge Oil",
  "Foothills Gas Partners",
] as const;
