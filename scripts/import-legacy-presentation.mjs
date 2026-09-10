import { readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2] || "../vie-group.github.io/presentation/index.html";
const seminarsPath = "data/seminars.json";

const monthNumbers = {
  jan: "01",
  january: "01",
  feb: "02",
  february: "02",
  mar: "03",
  march: "03",
  apr: "04",
  april: "04",
  may: "05",
  jun: "06",
  june: "06",
  jul: "07",
  july: "07",
  aug: "08",
  august: "08",
  sep: "09",
  sept: "09",
  september: "09",
  oct: "10",
  october: "10",
  nov: "11",
  november: "11",
  dec: "12",
  december: "12"
};

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKey(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "seminar";
}

function normalizePath(value) {
  return decodeHtml(value || "").trim().replace(/^\/+/, "");
}

function parseDate(value) {
  const match = String(value || "").trim().match(/^([A-Za-z]+)\.?\s+(\d{1,2}),?\s+(\d{4})$/);
  if (!match) throw new Error(`Could not parse legacy date: ${value}`);
  const month = monthNumbers[match[1].toLowerCase()];
  if (!month) throw new Error(`Unknown legacy month: ${value}`);
  return `${match[3]}-${month}-${String(Number(match[2])).padStart(2, "0")}`;
}

function extractRows(html) {
  const table = html.match(/<table id="seminar-content-list"[\s\S]*?<\/table>/i)?.[0] || html;
  return [...table.matchAll(/<tr(?:\s[^>]*)?>[\s\S]*?<\/tr>/gi)]
    .map((match) => match[0])
    .filter((row) => !/colspan\s*=\s*["']?2/i.test(row));
}

function extractLegacyRecord(row, index) {
  const title = stripHtml(row.match(/<b>([\s\S]*?)<\/b>/i)?.[1]);
  const speaker = stripHtml(row.match(/<font\s+size=["']?2["']?[^>]*>([\s\S]*?)<\/font>/i)?.[1]);
  const dateLabel = stripHtml(row.match(/<i>([\s\S]*?)<\/i>/i)?.[1]);
  if (!title || !speaker || !dateLabel) return null;

  const links = {};
  const image = normalizePath(row.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1]);
  if (image) links.image = image;

  for (const match of row.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = normalizePath(match[1]);
    const label = stripHtml(match[2]).toLowerCase();
    if (!href) continue;
    if (label === "pdf" && !links.paper) links.paper = href;
    if (label === "ppt" && !links.slides) links.slides = href;
  }

  const date = parseDate(dateLabel);
  return {
    id: `${date}-${slugify(title)}`,
    date,
    speaker,
    title,
    links,
    tags: [],
    source: {
      type: "legacy-static-presentation",
      repository: "vie-group/vie-group.github.io",
      path: "presentation/index.html",
      legacyOrder: index + 1
    }
  };
}

function recordKey(record) {
  return [record.date, normalizeKey(record.title), normalizeKey(record.speaker)].join("|");
}

function mergeRecord(existing, legacy) {
  const links = { ...(legacy.links || {}), ...(existing.links || {}) };
  for (const [key, value] of Object.entries(legacy.links || {})) {
    if (!existing.links?.[key] && value) links[key] = value;
  }
  return {
    ...legacy,
    ...existing,
    links,
    tags: Array.isArray(existing.tags) && existing.tags.length ? existing.tags : legacy.tags,
    source: existing.source || legacy.source
  };
}

const html = await readFile(sourcePath, "utf8");
const existing = JSON.parse(await readFile(seminarsPath, "utf8"));
const legacy = extractRows(html).map(extractLegacyRecord).filter(Boolean);

const nextByKey = new Map();
for (const record of legacy) nextByKey.set(recordKey(record), record);
for (const record of existing) {
  const key = recordKey(record);
  nextByKey.set(key, nextByKey.has(key) ? mergeRecord(record, nextByKey.get(key)) : record);
}

const next = [...nextByKey.values()].sort((a, b) => {
  const byDate = String(b.date || "").localeCompare(String(a.date || ""));
  if (byDate) return byDate;
  return Number(a.source?.legacyOrder || 99999) - Number(b.source?.legacyOrder || 99999);
});

const ids = new Set();
for (const record of next) {
  let id = record.id;
  let suffix = 2;
  while (ids.has(id)) {
    id = `${record.id}-${suffix}`;
    suffix += 1;
  }
  record.id = id;
  ids.add(id);
}

await writeFile(seminarsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Imported ${legacy.length} legacy seminar records; seminars.json now has ${next.length} records.`);
