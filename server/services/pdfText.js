const MAX_PAGES = 150;
const MAX_TEXT = 350000;

function pageLines(items, pageWidth) {
  const parts = items.filter(item => typeof item.str === "string" && item.str.trim()).map(item => ({
    x: Number(item.transform?.[4]) || 0,
    y: Number(item.transform?.[5]) || 0,
    width: Math.max(0, Number(item.width) || 0),
    text: item.str,
  })).sort((a, b) => b.y - a.y || a.x - b.x);
  const rows = [];
  for (const part of parts) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(last.y - part.y) <= 2) last.parts.push(part);
    else rows.push({ y: part.y, parts: [part] });
  }
  const splitGap = Math.max(48, pageWidth * 0.08);
  const runs = [];
  const rightStarts = [];
  for (const row of rows) {
    const ordered = row.parts.sort((a, b) => a.x - b.x);
    const rowRuns = [];
    for (const part of ordered) {
      const current = rowRuns[rowRuns.length - 1];
      if (!current || part.x - current.end > splitGap) {
        rowRuns.push({ x: part.x, y: row.y, end: part.x + part.width, parts: [part.text] });
      } else {
        current.parts.push(part.text);
        current.end = Math.max(current.end, part.x + part.width);
      }
    }
    if (rowRuns.length > 1) {
      let widest = null;
      for (let index = 1; index < rowRuns.length; index++) {
        const gap = rowRuns[index].x - rowRuns[index - 1].end;
        if (!widest || gap > widest.gap) widest = { gap, rightX: rowRuns[index].x };
      }
      if (widest && widest.gap > pageWidth * 0.12 && widest.rightX > pageWidth * 0.4)
        rightStarts.push(widest.rightX);
    }
    runs.push(...rowRuns.map(run => ({ ...run,
      text: run.parts.join(" ").replace(/\s+/g, " ").trim() })));
  }
  let boundary = null;
  if (rightStarts.length >= 2) {
    const sorted = [...rightStarts].sort((a, b) => a - b);
    if (sorted.at(-1) - sorted[0] <= pageWidth * 0.12)
      boundary = sorted[Math.floor(sorted.length / 2)] - 1;
  }
  const byPagePosition = (a, b) => b.y - a.y || a.x - b.x;
  const orderedRuns = boundary === null ? runs.sort(byPagePosition) : [
    ...runs.filter(run => run.x < boundary).sort(byPagePosition),
    ...runs.filter(run => run.x >= boundary).sort(byPagePosition),
  ];
  return orderedRuns.map(run => run.text).filter(Boolean);
}

async function extractPdfText(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.subarray(0, 5).toString() !== "%PDF-") {
    throw Object.assign(new Error("Not a PDF"), { code: "INVALID_PDF" });
  }
  let pdfjs;
  try { pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs"); }
  catch { throw Object.assign(new Error("PDF extractor unavailable"), { code: "PDF_EXTRACTOR_UNAVAILABLE" }); }
  let pdf;
  try { pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise; }
  catch { throw Object.assign(new Error("Invalid PDF"), { code: "INVALID_PDF" }); }
  if (pdf.numPages > MAX_PAGES) throw Object.assign(new Error("PDF page limit exceeded"), { code: "PDF_TOO_LARGE" });
  const blocks = [];
  let total = 0;
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });
    const ordered = pageLines(content.items, viewport.width);
    let heading = "";
    let chunk = "";
    let order = 0;
    function flush() {
      if (!chunk.trim()) return;
      const text = chunk.trim();
      total += text.length;
      if (total > MAX_TEXT) throw Object.assign(new Error("PDF text limit exceeded"), { code: "PDF_TOO_LARGE" });
      blocks.push({ page_number: pageNumber, reading_order: order++, heading_path: heading || null, text_content: text });
      chunk = "";
    }
    for (const line of ordered) {
      if (line.length < 110 && /^(?:\d+(?:\.\d+)*[.)]?\s+)?[\p{Lu}]/u.test(line) && !/[.!?]$/.test(line)) {
        flush();
        heading = line;
        chunk = line;
      } else {
        if (chunk.length + line.length > 1800) flush();
        chunk += (chunk ? "\n" : "") + line;
      }
    }
    flush();
  }
  return blocks;
}

module.exports = { extractPdfText, pageLines, MAX_PAGES, MAX_TEXT };
