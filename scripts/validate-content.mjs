import { access, readFile } from "node:fs/promises";

const files = [
  "data/site.json",
  "data/news.json",
  "data/team.json",
  "data/publications.json",
  "data/seminars.json",
  "data/activities.json",
  "data/activity-details.json"
];

function fail(message) {
  throw new Error(message);
}

function isIsoDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function requireString(item, key, label) {
  if (!item[key] || typeof item[key] !== "string") {
    fail(`${label} is missing string field "${key}".`);
  }
}

function checkUnique(items, label) {
  const seen = new Set();
  for (const item of items) {
    requireString(item, "id", label);
    if (seen.has(item.id)) fail(`${label} has duplicate id: ${item.id}`);
    seen.add(item.id);
  }
}

function collectOwnedAssetLinks(value, links = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectOwnedAssetLinks(item, links));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => collectOwnedAssetLinks(item, links));
  } else if (typeof value === "string" && value.startsWith("assets/")) {
    links.push(value);
  }
  return links;
}

const data = Object.fromEntries(
  await Promise.all(
    files.map(async (file) => {
      const value = JSON.parse(await readFile(file, "utf8"));
      return [file, value];
    })
  )
);
const config = JSON.parse(await readFile("content.config.json", "utf8"));

if (config.schemaVersion !== 1) fail("content.config.json schemaVersion must be 1.");
if (config.websiteRepository !== "vie-group/vie-group.github.io") {
  fail("content.config.json websiteRepository must be vie-group/vie-group.github.io.");
}
if (config.contentRepository !== "vie-group/vie-group-content") {
  fail("content.config.json contentRepository must be vie-group/vie-group-content.");
}

if (!data["data/site.json"].name || !data["data/site.json"].repository) {
  fail("data/site.json must include name and repository.");
}

for (const [file, value] of Object.entries(data)) {
  if (file !== "data/site.json" && !Array.isArray(value) && file !== "data/team.json") {
    fail(`${file} must be a JSON array.`);
  }
}

const publications = data["data/publications.json"];
checkUnique(publications, "publication");
for (const item of publications) {
  requireString(item, "title", "publication");
  requireString(item, "authors", "publication");
  requireString(item, "venue", "publication");
  if (!Number.isInteger(item.year)) fail(`publication ${item.id} has invalid year.`);
  if (!["conference", "journal", "dataset"].includes(item.type)) {
    fail(`publication ${item.id} has invalid type.`);
  }
  if (item.links && typeof item.links !== "object") fail(`publication ${item.id} links must be an object.`);
}

const seminars = data["data/seminars.json"];
checkUnique(seminars, "seminar");
for (const item of seminars) {
  requireString(item, "title", "seminar");
  requireString(item, "speaker", "seminar");
  if (!isIsoDate(item.date)) fail(`seminar ${item.id} must use YYYY-MM-DD date.`);
  if (item.links && typeof item.links !== "object") fail(`seminar ${item.id} links must be an object.`);
}

for (const item of data["data/news.json"]) {
  if (!isIsoDate(item.date)) fail(`news item must use YYYY-MM-DD date: ${item.text}`);
  requireString(item, "text", "news item");
}

for (const item of data["data/activities.json"]) {
  if (!isIsoDate(item.date)) fail(`activity item must use YYYY-MM-DD date: ${item.title}`);
  requireString(item, "title", "activity");
}

const activityDetails = data["data/activity-details.json"];
checkUnique(activityDetails, "activity detail");
for (const item of activityDetails) {
  requireString(item, "legacyId", "activity detail");
  requireString(item, "title", "activity detail");
  requireString(item, "detailText", "activity detail");
  if (!isIsoDate(item.date)) fail(`activity detail ${item.id} must use YYYY-MM-DD date.`);
  if (!Array.isArray(item.images)) fail(`activity detail ${item.id} images must be an array.`);
}

const team = data["data/team.json"];
for (const group of ["faculty", "current", "alumni"]) {
  if (!Array.isArray(team[group])) fail(`team.${group} must be an array.`);
}

const ownedAssetLinks = new Set([
  ...collectOwnedAssetLinks(publications),
  ...collectOwnedAssetLinks(seminars),
  ...collectOwnedAssetLinks(activityDetails)
]);
for (const link of ownedAssetLinks) {
  await access(link).catch(() => fail(`Missing owned asset referenced by data: ${link}`));
}

console.log("All content data files are valid.");
