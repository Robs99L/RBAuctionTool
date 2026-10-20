import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";

import {
  createAuctionImportTemplate,
  parseAuctionImport,
} from "./auction-excel";

describe("auction Excel import", () => {
  it("creates a template that imports populated event rows with defaults", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createAuctionImportTemplate());
    const sheet = workbook.getWorksheet("Events");
    expect(sheet).toBeDefined();
    sheet!.getCell("A2").value = "Imported event";
    sheet!.getCell("B2").value = "Created from Excel";

    const buffer = await workbook.xlsx.writeBuffer();
    const result = await parseAuctionImport(new Uint8Array(buffer));
    expect(result).toEqual({
      ok: true,
      auctions: [{
        title: "Imported event",
        description: "Created from Excel",
        image_url: null,
        starting_price: 0,
        minimum_increment: 1,
        maximum_bid_difference: null,
        winner_count: 1,
        timer_duration_seconds: 120,
        currency: "EUR",
        status: "upcoming",
      }],
    });
  });

  it("reports spreadsheet row numbers without returning partial data", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await createAuctionImportTemplate());
    const sheet = workbook.getWorksheet("Events")!;
    sheet.getCell("A2").value = "Broken event";
    sheet.getCell("E2").value = 10;
    sheet.getCell("F2").value = 5;

    const result = await parseAuctionImport(new Uint8Array(await workbook.xlsx.writeBuffer()));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.rowErrors?.[0]).toContain("Row 2:");
  });
});
