import ExcelJS, { type CellValue, type Worksheet } from "exceljs";

import {
  validateAuctionInput,
  validateHttpsImageUrl,
  type ValidAuctionInput,
} from "./auction-input";

export const AUCTION_IMPORT_MAX_EVENTS = 500;
export const AUCTION_IMPORT_MAX_BYTES = 2 * 1024 * 1024;
export const AUCTION_IMPORT_SHEET = "Events";

export type ImportedAuction = ValidAuctionInput & {
  image_url: string | null;
  status: "upcoming";
};

export type AuctionImportResult =
  | { ok: true; auctions: ImportedAuction[] }
  | { ok: false; error: string; rowErrors?: string[] };

const columns = [
  { key: "title", header: "Eventname*", width: 34 },
  { key: "description", header: "Beschreibung", width: 54 },
  { key: "imageUrl", header: "Bild-URL (optional)", width: 40 },
  { key: "startingPrice", header: "Startpreis", width: 16 },
  { key: "minimumIncrement", header: "Mindestschritt", width: 18 },
  { key: "maximumDifference", header: "Max. Erhöhung (optional)", width: 25 },
  { key: "winnerCount", header: "Anzahl Gewinner", width: 19 },
  { key: "timerDurationMinutes", header: "Timer (Minuten)", width: 20 },
  { key: "currency", header: "Währung", width: 14 },
] as const;

type ColumnKey = (typeof columns)[number]["key"];

function styleHeader(worksheet: Worksheet) {
  const header = worksheet.getRow(1);
  header.height = 28;
  header.font = { bold: true, color: { argb: "FFFFFFFF" } };
  header.alignment = { vertical: "middle", wrapText: true };
  header.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF00503C" } };
  header.eachCell((cell) => {
    cell.border = { bottom: { style: "thin", color: { argb: "FFB8D900" } } };
  });
}

export async function createAuctionImportTemplate() {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Christmas Auction Tool";
  workbook.created = new Date();
  workbook.modified = new Date();

  const events = workbook.addWorksheet(AUCTION_IMPORT_SHEET, {
    views: [{ state: "frozen", ySplit: 1 }],
    properties: { defaultRowHeight: 20 },
  });
  events.columns = columns.map((column) => ({ ...column }));
  events.autoFilter = { from: "A1", to: "I1" };
  styleHeader(events);

  for (let rowNumber = 2; rowNumber <= AUCTION_IMPORT_MAX_EVENTS + 1; rowNumber += 1) {
    events.getCell(`A${rowNumber}`).dataValidation = {
      type: "textLength",
      operator: "between",
      allowBlank: true,
      formulae: [1, 120],
      showErrorMessage: true,
      errorTitle: "Ungültiger Eventname",
      error: "Bitte 1 bis 120 Zeichen eingeben.",
    };
    events.getCell(`D${rowNumber}`).dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0, 9_999_999_999.99],
    };
    events.getCell(`E${rowNumber}`).dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0.01, 9_999_999_999.99],
    };
    events.getCell(`F${rowNumber}`).dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0.01, 9_999_999_999.99],
    };
    events.getCell(`G${rowNumber}`).dataValidation = {
      type: "whole",
      operator: "between",
      allowBlank: true,
      formulae: [1, 1000],
    };
    events.getCell(`H${rowNumber}`).dataValidation = {
      type: "decimal",
      operator: "between",
      allowBlank: true,
      formulae: [0.5, 1440],
    };
    events.getCell(`I${rowNumber}`).dataValidation = {
      type: "textLength",
      operator: "equal",
      allowBlank: true,
      formulae: [3],
    };
  }

  events.getColumn("D").numFmt = "#,##0.00";
  events.getColumn("E").numFmt = "#,##0.00";
  events.getColumn("F").numFmt = "#,##0.00";
  events.getColumn("G").numFmt = "0";
  events.getColumn("H").numFmt = "0.0";
  events.getColumn("I").alignment = { horizontal: "center" };

  const example = workbook.addWorksheet("Beispiel");
  example.columns = columns.map((column) => ({ ...column }));
  styleHeader(example);
  example.addRow({
    title: "Dinner für zwei",
    description: "Beispielbeschreibung – diese Zeile nicht in das Events-Blatt kopieren, wenn sie nicht importiert werden soll.",
    imageUrl: "https://example.com/event-image.jpg",
    startingPrice: 0,
    minimumIncrement: 5,
    maximumDifference: 50,
    winnerCount: 1,
    timerDurationMinutes: 2,
    currency: "EUR",
  });

  const guide = workbook.addWorksheet("Hinweise");
  guide.columns = [
    { key: "field", header: "Spalte", width: 28 },
    { key: "required", header: "Pflicht", width: 12 },
    { key: "rule", header: "Inhalt / Regel", width: 80 },
  ];
  styleHeader(guide);
  [
    ["Eventname", "Ja", "1–120 Zeichen."],
    ["Beschreibung", "Nein", "Maximal 4.000 Zeichen."],
    ["Bild-URL", "Nein", "Öffentlich erreichbare HTTPS-URL, maximal 2.000 Zeichen. Eingebettete Bilder werden nicht importiert."],
    ["Startpreis", "Nein", "0 oder höher, maximal zwei Nachkommastellen. Standard: 0."],
    ["Mindestschritt", "Nein", "Größer als 0, maximal zwei Nachkommastellen. Standard: 1."],
    ["Max. Erhöhung", "Nein", "Leer bedeutet unbegrenzt; sonst mindestens so hoch wie der Mindestschritt."],
    ["Anzahl Gewinner", "Nein", "Ganze Zahl von 1 bis 1.000. Standard: 1."],
    ["Timer (Minuten)", "Nein", "0,5 bis 1.440 Minuten. Standard: 2."],
    ["Währung", "Nein", "Dreistelliger ISO-Code, z. B. EUR. Standard: EUR."],
    ["Zeilenreihenfolge", "–", "Die Events werden in derselben Reihenfolge am Ende der bestehenden Queue ergänzt."],
    ["Status", "–", "Alle importierten Events werden als upcoming angelegt."],
  ].forEach((row) => guide.addRow(row));
  guide.getColumn(3).alignment = { wrapText: true, vertical: "top" };

  return workbook.xlsx.writeBuffer();
}

function plainCellValue(value: CellValue): string | number {
  if (typeof value === "string" || typeof value === "number") return value;
  if (value == null || value instanceof Date) return "";
  if (typeof value === "object") {
    if ("result" in value) return plainCellValue(value.result as CellValue);
    if ("hyperlink" in value && typeof value.hyperlink === "string") return value.hyperlink;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("text" in value && typeof value.text === "string") return value.text;
  }
  return "";
}

function isBlank(value: string | number) {
  return typeof value === "string" ? value.trim() === "" : false;
}

export async function parseAuctionImport(buffer: Uint8Array): Promise<AuctionImportResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(new Uint8Array(buffer).buffer);
  } catch {
    return {
      ok: false,
      error: "The Excel file could not be read. Download a fresh .xlsx template and try again.",
    };
  }

  const worksheet = workbook.getWorksheet(AUCTION_IMPORT_SHEET);
  if (!worksheet) {
    return { ok: false, error: `The workbook must contain a sheet named "${AUCTION_IMPORT_SHEET}".` };
  }
  if (worksheet.rowCount > AUCTION_IMPORT_MAX_EVENTS + 1) {
    return {
      ok: false,
      error: `A maximum of ${AUCTION_IMPORT_MAX_EVENTS} event rows can be imported at once.`,
    };
  }

  const headerPositions = new Map<string, number>();
  worksheet.getRow(1).eachCell((cell, columnNumber) => {
    headerPositions.set(String(plainCellValue(cell.value)).trim(), columnNumber);
  });
  const missingHeaders = columns
    .filter((column) => !headerPositions.has(column.header))
    .map((column) => column.header);
  if (missingHeaders.length) {
    return {
      ok: false,
      error: `Required column headings are missing or changed: ${missingHeaders.join(", ")}.`,
    };
  }

  const auctions: ImportedAuction[] = [];
  const rowErrors: string[] = [];
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const values = Object.fromEntries(columns.map((column) => [
      column.key,
      plainCellValue(row.getCell(headerPositions.get(column.header)!).value),
    ])) as Record<ColumnKey, string | number>;
    if (Object.values(values).every(isBlank)) continue;

    const validation = validateAuctionInput({
      title: values.title,
      description: values.description,
      startingPrice: isBlank(values.startingPrice) ? 0 : values.startingPrice,
      minimumIncrement: isBlank(values.minimumIncrement) ? 1 : values.minimumIncrement,
      maximumDifference: values.maximumDifference,
      winnerCount: isBlank(values.winnerCount) ? 1 : values.winnerCount,
      timerDurationMinutes: isBlank(values.timerDurationMinutes) ? 2 : values.timerDurationMinutes,
      currency: isBlank(values.currency) ? "EUR" : values.currency,
    });
    const imageUrl = validateHttpsImageUrl(values.imageUrl);
    const errors = [
      ...(validation.ok ? [] : validation.errors),
      ...(imageUrl.ok ? [] : [imageUrl.error]),
    ];
    if (errors.length) {
      rowErrors.push(`Row ${rowNumber}: ${errors.join(" ")}`);
      continue;
    }

    if (validation.ok && imageUrl.ok) {
      auctions.push({ ...validation.value, image_url: imageUrl.value, status: "upcoming" });
    }
  }

  if (rowErrors.length) {
    return {
      ok: false,
      error: `${rowErrors.length} event row${rowErrors.length === 1 ? " has" : "s have"} invalid values. Nothing was imported.`,
      rowErrors: rowErrors.slice(0, 20),
    };
  }
  if (!auctions.length) {
    return { ok: false, error: "The Events sheet does not contain any event rows." };
  }

  return { ok: true, auctions };
}
