import { readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2] || "../vie-group.github.io/publication/index.html";
const publicationsPath = "data/publications.json";

const sectionTypes = {
  "journal publications": "journal",
  "conference publications": "conference",
  datasets: "dataset"
};

const venueMarkers = [
  "IEEE",
  "ACM",
  "Association for the Advancement of Artificial Intelligence",
  "AAAI",
  "CVPR",
  "ICCV",
  "ECCV",
  "ICRA",
  "ICASSP",
  "ICME",
  "Bioinformatics",
  "Frontiers",
  "Computers",
  "Computer Vision",
  "European Conference",
  "Asian Conference",
  "International Conference",
  "International Joint Conference",
  "International Journal",
  "Journal",
  "Journal of Computational Mathematics",
  "Winter Conference on Applications of Computer Vision",
  "Chinese Science Bulletin",
  "Signal, Image and Video Processing",
  "ZTE COMMUNICATIONS"
];

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;|&ensp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<a\b[\s\S]*?<\/a>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/[，]/g, ",")
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
  return slug || "publication";
}

function normalizePath(value) {
  return decodeHtml(value || "").trim().replace(/^\/+/, "");
}

function extractSections(html) {
  const headingPattern = /<td class="publications">([\s\S]*?)<\/td>/gi;
  const headings = [...html.matchAll(headingPattern)].map((match) => ({
    title: stripHtml(match[1]),
    index: match.index
  }));
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index || html.length;
    return {
      title: heading.title,
      type: sectionTypes[heading.title.toLowerCase()],
      html: html.slice(heading.index, end)
    };
  });
}

function extractLinks(html) {
  const links = {};
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = normalizePath(match[1]);
    const label = stripHtml(match[2]).replace(/^\[|\]$/g, "").toLowerCase();
    if (!href || !label) continue;
    if (label === "ppt") {
      if (!links.slide) links.slide = href;
    } else if (["pdf", "code", "slide", "poster"].includes(label) && !links[label]) {
      links[label] = href;
    }
  }
  return links;
}

function extractYear(citation) {
  const years = [...String(citation).matchAll(/\b(19|20)\d{2}\b/g)].map((match) => Number(match[0]));
  const plausible = years.filter((year) => year >= 1900 && year <= 2030);
  if (!plausible.length) return 1970;
  return Math.max(...plausible);
}

function findVenueMarker(rest) {
  const lower = rest.toLowerCase();
  let best = -1;
  for (const marker of venueMarkers) {
    const index = lower.indexOf(marker.toLowerCase());
    if (index >= 0 && (best < 0 || index < best)) best = index;
  }
  return best;
}

function findSentencePeriod(value) {
  const text = String(value || "");
  for (const match of text.matchAll(/\.\s+/g)) {
    const index = match.index;
    const before = text.slice(0, index).trim();
    const token = before.split(/[\s,]+/).pop() || "";
    if (/^[A-Z]$/.test(token)) continue;
    if (findVenueMarker(before) >= 0) return -1;
    return index;
  }
  return -1;
}

function cleanSentence(value) {
  return String(value || "")
    .replace(/^[\s,.;]+|[\s,.;]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function splitCitation(citation) {
  const text = cleanSentence(citation);
  const firstPeriod = findSentencePeriod(text);
  if (firstPeriod > 0 && firstPeriod < 180) {
    const authors = cleanSentence(text.slice(0, firstPeriod));
    const rest = cleanSentence(text.slice(firstPeriod + 2));
    const marker = findVenueMarker(rest);
    if (marker > 5) {
      return {
        authors,
        title: cleanSentence(rest.slice(0, marker)),
        detail: cleanSentence(rest.slice(marker))
      };
    }
    const secondPeriod = rest.indexOf(". ");
    if (secondPeriod > 5) {
      return {
        authors,
        title: cleanSentence(rest.slice(0, secondPeriod)),
        detail: cleanSentence(rest.slice(secondPeriod + 2))
      };
    }
  }

  const marker = findVenueMarker(text);
  if (marker > 0) {
    const prefix = cleanSentence(text.slice(0, marker));
    const detail = cleanSentence(text.slice(marker));
    const comma = prefix.lastIndexOf(",");
    if (comma > 0) {
      return {
        authors: cleanSentence(prefix.slice(0, comma)),
        title: cleanSentence(prefix.slice(comma + 1)),
        detail
      };
    }
  }

  const parts = text.split(/\s*,\s*/);
  return {
    authors: cleanSentence(parts.slice(0, Math.max(1, parts.length - 2)).join(", ")),
    title: cleanSentence(parts.at(-2) || text),
    detail: cleanSentence(parts.at(-1) || "")
  };
}

function splitVenueAndNote(detail, year) {
  const clean = cleanSentence(detail);
  if (!clean) return { venue: "Unknown venue", note: "" };
  const yearIndex = clean.indexOf(String(year));
  if (yearIndex > 0) {
    const beforeYear = clean.slice(0, yearIndex);
    const comma = beforeYear.lastIndexOf(",");
    if (comma > 0) {
      return {
        venue: cleanSentence(clean.slice(0, comma)),
        note: cleanSentence(clean.slice(comma + 1))
      };
    }
  }
  const comma = clean.indexOf(",");
  if (comma > 0) {
    return {
      venue: cleanSentence(clean.slice(0, comma)),
      note: cleanSentence(clean.slice(comma + 1))
    };
  }
  return { venue: clean, note: "" };
}

function extractLegacyRecord(section, itemHtml, index) {
  const citation = stripHtml(itemHtml);
  if (!citation) return null;
  const year = extractYear(citation);
  const split = splitCitation(citation);
  const venue = splitVenueAndNote(split.detail, year);
  const title = split.title || citation;
  return {
    id: `${slugify(split.authors.split(/,|\sand\s/i)[0])}-${year}-${slugify(title)}`,
    type: section.type || "conference",
    year,
    authors: split.authors || "Unknown authors",
    title,
    venue: venue.venue,
    note: venue.note,
    links: extractLinks(itemHtml),
    tags: [],
    rawCitation: citation,
    source: {
      type: "legacy-static-publication",
      repository: "vie-group/vie-group.github.io",
      path: "publication/index.html",
      legacySection: section.title,
      legacyOrder: index + 1
    }
  };
}

function recordKey(record) {
  return normalizeKey(record.title);
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
    rawCitation: existing.rawCitation || legacy.rawCitation,
    source: existing.source || legacy.source
  };
}

const html = await readFile(sourcePath, "utf8");
const existing = JSON.parse(await readFile(publicationsPath, "utf8"));
const legacy = extractSections(html)
  .filter((section) => section.type)
  .flatMap((section) =>
    [...section.html.matchAll(/<li\b[\s\S]*?<\/li>/gi)]
      .map((match, index) => extractLegacyRecord(section, match[0], index))
      .filter(Boolean)
  );

const nextByKey = new Map();
for (const record of legacy) nextByKey.set(recordKey(record), record);
for (const record of existing) {
  const key = recordKey(record);
  nextByKey.set(key, nextByKey.has(key) ? mergeRecord(record, nextByKey.get(key)) : record);
}

const next = [...nextByKey.values()].sort(
  (a, b) => Number(b.year || 0) - Number(a.year || 0) || String(a.title).localeCompare(String(b.title))
);

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

await writeFile(publicationsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Imported ${legacy.length} legacy publication records; publications.json now has ${next.length} records.`);
