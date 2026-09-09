import { readFile, writeFile } from "node:fs/promises";

const command = process.argv[2];

function env(name, fallback = "") {
  return process.env[name] || fallback;
}

function required(name) {
  const value = env(name).trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function slugify(value) {
  const slug = String(value)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `item-${Date.now()}`;
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function maybeLinks(keys) {
  const links = {};
  for (const [label, name] of Object.entries(keys)) {
    const value = env(name).trim();
    if (value) links[label] = value;
  }
  return links;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function writeJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function addSeminar() {
  const date = required("SEMINAR_DATE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("SEMINAR_DATE must use YYYY-MM-DD.");
  const title = required("SEMINAR_TITLE");
  const speaker = required("SEMINAR_SPEAKER");
  const record = {
    id: env("SEMINAR_ID", `${date}-${slugify(title)}`).trim(),
    date,
    speaker,
    title,
    abstract: env("SEMINAR_ABSTRACT").trim(),
    links: maybeLinks({
      image: "SEMINAR_IMAGE_URL",
      paper: "SEMINAR_PAPER_URL",
      slides: "SEMINAR_SLIDES_URL",
      video: "SEMINAR_VIDEO_URL",
      code: "SEMINAR_CODE_URL"
    }),
    tags: splitTags(env("SEMINAR_TAGS"))
  };

  const path = "data/seminars.json";
  const items = await readJson(path);
  const next = [record, ...items.filter((item) => item.id !== record.id)].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
  await writeJson(path, next);
  console.log(`Added seminar: ${record.id}`);
}

async function addNews() {
  const date = required("NEWS_DATE");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("NEWS_DATE must use YYYY-MM-DD.");
  const text = required("NEWS_TEXT");
  const record = { date, text };

  const path = "data/news.json";
  const items = await readJson(path);
  const next = [record, ...items.filter((item) => item.date !== record.date || item.text !== record.text)].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
  await writeJson(path, next);
  console.log(`Added news: ${date}`);
}

async function addPublication() {
  const title = required("PUBLICATION_TITLE");
  const year = Number(required("PUBLICATION_YEAR"));
  if (!Number.isInteger(year)) throw new Error("PUBLICATION_YEAR must be an integer.");
  const type = env("PUBLICATION_TYPE", "conference");
  if (!["conference", "journal", "dataset"].includes(type)) throw new Error("PUBLICATION_TYPE is invalid.");

  const record = {
    id: env("PUBLICATION_ID", `${year}-${slugify(title)}`).trim(),
    type,
    year,
    authors: required("PUBLICATION_AUTHORS"),
    title,
    venue: required("PUBLICATION_VENUE"),
    note: env("PUBLICATION_NOTE").trim(),
    links: maybeLinks({
      pdf: "PUBLICATION_PDF_URL",
      code: "PUBLICATION_CODE_URL",
      slide: "PUBLICATION_SLIDE_URL",
      poster: "PUBLICATION_POSTER_URL"
    }),
    tags: splitTags(env("PUBLICATION_TAGS"))
  };

  const path = "data/publications.json";
  const items = await readJson(path);
  const next = [record, ...items.filter((item) => item.id !== record.id)].sort(
    (a, b) => Number(b.year || 0) - Number(a.year || 0) || String(a.title).localeCompare(String(b.title))
  );
  await writeJson(path, next);
  console.log(`Added publication: ${record.id}`);
}

if (command === "add-seminar") {
  await addSeminar();
} else if (command === "add-news") {
  await addNews();
} else if (command === "add-publication") {
  await addPublication();
} else {
  throw new Error("Usage: node scripts/update-data.mjs <add-news|add-seminar|add-publication>");
}
