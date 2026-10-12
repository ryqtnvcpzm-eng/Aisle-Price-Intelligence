import "server-only";
import path from "node:path";
import { currencyExponent, formatMoney, formatPct } from "@/lib/money";
import type { ReportColumn, ReportData, ReportSection } from "./build";

type Row = Record<string, string | number | null>;

function cellText(col: ReportColumn, row: Row): string {
  const v = row[col.key];
  if (v === null || v === undefined || v === "") return "—";
  switch (col.kind) {
    case "money":
      return formatMoney(Number(v), String(row[col.currencyKey ?? "currency"] ?? "INR"), undefined, { trimZeros: false });
    case "pct":
      return formatPct(Number(v), { signed: col.key.startsWith("ch") || col.key === "premium" || col.key === "change" });
    case "date":
      return new Date(String(v)).toISOString().replace("T", " ").slice(0, 16) + " UTC";
    default:
      return String(v);
  }
}

/** Machine-friendly value: money as major units (decimal), pct as ratio, dates ISO. */
function cellValue(col: ReportColumn, row: Row): string | number | null {
  const v = row[col.key];
  if (v === null || v === undefined) return null;
  if (col.kind === "money") {
    const cur = String(row[col.currencyKey ?? "currency"] ?? "INR");
    const exp = currencyExponent(cur);
    return (Number(v) / 10 ** exp).toFixed(exp);
  }
  return v;
}

function csvEscape(s: string) {
  // Neutralise spreadsheet formula injection, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function renderCsv(r: ReportData): Buffer {
  const lines: string[] = [];
  lines.push(`# ${r.title}`);
  lines.push(`# Generated ${r.generatedAt} · data as of ${r.dataAsOf ?? "n/a"} · provider ${r.provider}`);
  if (r.containsSimulated) lines.push("# WARNING: contains SIMULATED demo data — not real Amazon prices");
  for (const f of r.filters) lines.push(`# ${f}`);
  for (const s of r.sections) {
    lines.push("");
    lines.push(`# ${s.title}`);
    lines.push(s.columns.map((c) => csvEscape(c.kind === "money" ? `${c.label} (major units)` : c.label)).join(","));
    for (const row of s.rows) lines.push(s.columns.map((c) => csvEscape(String(cellValue(c, row) ?? ""))).join(","));
  }
  return Buffer.from(`﻿${lines.join("\n")}\n`, "utf8");
}

export async function renderXlsx(r: ReportData): Promise<Buffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Aisle";
  wb.created = new Date(r.generatedAt);
  const about = wb.addWorksheet("About");
  about.columns = [{ width: 24 }, { width: 100 }];
  const meta: [string, string][] = [
    ["Report", r.title],
    ["Summary", r.subtitle],
    ["Generated", r.generatedAt],
    ["Data as of", r.dataAsOf ?? "n/a"],
    ["Data provider", r.provider],
    ["Simulated data", r.containsSimulated ? "YES — demo data, not real Amazon prices" : "No"],
    ...r.filters.map((f): [string, string] => ["Filter", f]),
    ...r.methodology.map((m): [string, string] => ["Methodology", m]),
  ];
  about.addRows(meta);
  about.getColumn(1).font = { bold: true };
  about.getRow(1).font = { bold: true, size: 14 };

  for (const s of r.sections) {
    const ws = wb.addWorksheet(s.title.slice(0, 31));
    ws.columns = s.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(10, (c.width ?? 12) * 1.1) }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const row of s.rows) {
      const out: Record<string, unknown> = {};
      for (const c of s.columns) {
        const v = row[c.key];
        if (v === null || v === undefined) out[c.key] = null;
        else if (c.kind === "money") out[c.key] = Number(v) / 10 ** currencyExponent(String(row[c.currencyKey ?? "currency"] ?? "INR"));
        else if (c.kind === "date") out[c.key] = new Date(String(v));
        else out[c.key] = v;
      }
      ws.addRow(out);
    }
    s.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1);
      if (c.kind === "money") col.numFmt = "#,##0.00";
      if (c.kind === "pct") col.numFmt = "0.0%";
      if (c.kind === "date") col.numFmt = "yyyy-mm-dd hh:mm";
    });
    if (s.description) ws.getCell(1, s.columns.length + 2).value = s.description;
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const FONT_DIR = path.join(process.cwd(), "assets", "fonts");

export async function renderPdf(r: ReportData): Promise<Buffer> {
  const PDFDocument = (await import("pdfkit")).default;
  const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 40, info: { Title: r.title, Author: "Aisle", Creator: "Aisle Price Intelligence" } });
  // Geist covers ₹ € £ ¥ and other currency glyphs missing from PDF base-14 fonts.
  doc.registerFont("body", path.join(FONT_DIR, "Geist-Regular.ttf"));
  doc.registerFont("bold", path.join(FONT_DIR, "Geist-SemiBold.ttf"));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<Buffer>((res) => doc.on("end", () => res(Buffer.concat(chunks))));

  const ink = "#1d1d1f";
  const muted = "#6e6e73";
  const hair = "#d2d2d7";
  const accent = "#0a7d5a";
  const W = doc.page.width - 80;

  doc.font("bold").fontSize(20).fillColor(ink).text(r.title, 40, 40, { width: W });
  doc.font("body").fontSize(10).fillColor(muted).text(r.subtitle, { width: W });
  doc.moveDown(0.4);
  doc.fontSize(8).text(`Generated ${r.generatedAt.replace("T", " ").slice(0, 16)} UTC · Data as of ${r.dataAsOf ? r.dataAsOf.replace("T", " ").slice(0, 16) + " UTC" : "n/a"} · Provider: ${r.provider}`);
  doc.text(r.filters.join("  ·  "));
  if (r.containsSimulated) {
    doc.moveDown(0.3).font("bold").fillColor("#b25000").text("Contains SIMULATED demo data — these are not real Amazon prices.");
  }
  doc.moveDown(0.8);

  const ensure = (h: number) => {
    if (doc.y + h > doc.page.height - 50) doc.addPage();
  };

  const drawBars = (s: ReportSection) => {
    if (!s.bars) return;
    const data = s.rows.filter((x) => typeof x[s.bars!.valueKey] === "number").slice(0, 12);
    if (data.length < 2) return;
    const max = Math.max(...data.map((x) => Number(x[s.bars!.valueKey])));
    ensure(data.length * 16 + 20);
    const x0 = 40;
    const labelW = 220;
    const barW = W - labelW - 90;
    for (const row of data) {
      const v = Number(row[s.bars.valueKey]);
      const y = doc.y;
      doc.font("body").fontSize(8).fillColor(ink).text(String(row[s.bars.labelKey]).slice(0, 48), x0, y + 2, { width: labelW - 8, lineBreak: false });
      doc.rect(x0 + labelW, y + 2, Math.max(2, (v / max) * barW), 9).fill(row.role === "reference" ? accent : "#8e8e93");
      doc.fillColor(muted).text(formatMoney(v, String(row[s.bars.currencyKey ?? "currency"] ?? "INR"), undefined, { trimZeros: false }), x0 + labelW + (v / max) * barW + 6, y + 2, { lineBreak: false });
      doc.y = y + 15;
    }
    doc.moveDown(0.8);
  };

  const drawTable = (s: ReportSection) => {
    const total = s.columns.reduce((a, c) => a + (c.width ?? 12), 0);
    const widths = s.columns.map((c) => ((c.width ?? 12) / total) * W);
    const header = () => {
      ensure(40);
      const y = doc.y;
      let x = 40;
      doc.font("bold").fontSize(7.5).fillColor(muted);
      s.columns.forEach((c, i) => {
        doc.text(c.label.toUpperCase(), x + 2, y, { width: widths[i]! - 4, align: c.kind === "text" || c.kind === "date" ? "left" : "right", lineBreak: false });
        x += widths[i]!;
      });
      doc.moveTo(40, y + 12).lineTo(40 + W, y + 12).lineWidth(0.5).strokeColor(hair).stroke();
      doc.y = y + 16;
    };
    header();
    for (const row of s.rows) {
      const texts = s.columns.map((c) => cellText(c, row));
      const h = Math.max(...texts.map((t, i) => doc.font("body").fontSize(8).heightOfString(t, { width: widths[i]! - 4 }))) + 5;
      if (doc.y + h > doc.page.height - 50) {
        doc.addPage();
        header();
      }
      const y = doc.y;
      let x = 40;
      texts.forEach((t, i) => {
        const c = s.columns[i]!;
        doc.font("body").fontSize(8).fillColor(t === "—" ? muted : ink).text(t, x + 2, y, { width: widths[i]! - 4, align: c.kind === "text" || c.kind === "date" ? "left" : "right" });
        x += widths[i]!;
      });
      doc.moveTo(40, y + h - 2).lineTo(40 + W, y + h - 2).lineWidth(0.25).strokeColor(hair).stroke();
      doc.y = y + h;
    }
    if (!s.rows.length) doc.font("body").fontSize(9).fillColor(muted).text("No data for the selected filters.", 40);
    doc.moveDown(1);
  };

  for (const s of r.sections) {
    ensure(60);
    doc.font("bold").fontSize(12).fillColor(ink).text(s.title, 40);
    if (s.description) doc.font("body").fontSize(8.5).fillColor(muted).text(s.description, 40, undefined, { width: W });
    doc.moveDown(0.5);
    drawBars(s);
    drawTable(s);
  }
  ensure(80);
  doc.font("bold").fontSize(10).fillColor(ink).text("Methodology", 40);
  doc.font("body").fontSize(8).fillColor(muted);
  for (const m of r.methodology) doc.text(`• ${m}`, 40, undefined, { width: W });
  doc.end();
  return done;
}

export async function renderReport(r: ReportData, format: "csv" | "xlsx" | "pdf") {
  const slug = r.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  const stamp = r.generatedAt.slice(0, 10);
  if (format === "csv") return { body: renderCsv(r), type: "text/csv; charset=utf-8", filename: `${slug}-${stamp}.csv` };
  if (format === "xlsx") return { body: await renderXlsx(r), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename: `${slug}-${stamp}.xlsx` };
  return { body: await renderPdf(r), type: "application/pdf", filename: `${slug}-${stamp}.pdf` };
}
