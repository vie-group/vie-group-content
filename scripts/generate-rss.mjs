import { readFile, writeFile } from "node:fs/promises";

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function absoluteUrl(baseUrl, path) {
  return new URL(path, baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
}

function dateFromYear(year) {
  return new Date(Date.UTC(Number(year) || 1970, 0, 1, 12, 0, 0));
}

function dateFromIso(value) {
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? new Date(0) : date;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

const [config, site, news, publications, seminars] = await Promise.all([
  readJson("content.config.json"),
  readJson("data/site.json"),
  readJson("data/news.json"),
  readJson("data/publications.json"),
  readJson("data/seminars.json")
]);

const siteBaseUrl = site.url || "https://www.vie.group";
const rssUrl = config.rssUrl || absoluteUrl(config.publicBaseUrl || siteBaseUrl, "rss.xml");

const publicationItems = publications.map((item) => ({
  title: `Publication: ${item.title}`,
  description: [item.authors, item.venue, item.note].filter(Boolean).join(". "),
  date: dateFromYear(item.year),
  link: absoluteUrl(siteBaseUrl, "publication/"),
  guid: `publication:${item.id}`,
  categories: ["publication", item.type, ...(item.tags || [])]
}));

const seminarItems = seminars.map((item) => ({
  title: `Seminar: ${item.title}`,
  description: [item.speaker, item.abstract].filter(Boolean).join(". "),
  date: dateFromIso(item.date),
  link: absoluteUrl(siteBaseUrl, "presentation/"),
  guid: `seminar:${item.id}`,
  categories: ["seminar", ...(item.tags || [])]
}));

const newsItems = news.map((item, index) => ({
  title: `News: ${item.text.slice(0, 90)}${item.text.length > 90 ? "..." : ""}`,
  description: item.text,
  date: dateFromIso(item.date),
  link: absoluteUrl(siteBaseUrl, "home/"),
  guid: `news:${item.date}:${index}`,
  categories: ["news"]
}));

const items = [...publicationItems, ...seminarItems, ...newsItems]
  .sort((a, b) => b.date.getTime() - a.date.getTime())
  .slice(0, 60);
const lastBuildDate = (items[0]?.date || new Date(0)).toUTCString();

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEscape(site.fullName || site.name)}</title>
    <link>${xmlEscape(siteBaseUrl)}</link>
    <description>${xmlEscape(site.description)}</description>
    <language>en-us</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${xmlEscape(rssUrl)}" rel="self" type="application/rss+xml"/>
${items
  .map(
    (item) => `    <item>
      <title>${xmlEscape(item.title)}</title>
      <link>${xmlEscape(item.link)}</link>
      <guid isPermaLink="false">${xmlEscape(item.guid)}</guid>
      <pubDate>${item.date.toUTCString()}</pubDate>
      <description>${xmlEscape(item.description)}</description>
${item.categories.filter(Boolean).map((category) => `      <category>${xmlEscape(category)}</category>`).join("\n")}
    </item>`
  )
  .join("\n")}
  </channel>
</rss>
`;

await writeFile("rss.xml", rss, "utf8");
console.log(`Generated rss.xml with ${items.length} items.`);
