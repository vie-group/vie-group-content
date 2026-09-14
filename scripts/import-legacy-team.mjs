import { readFile, writeFile } from "node:fs/promises";

const sourcePath = process.argv[2] || "../vie-group.github.io/team/index.html";
const teamPath = "data/team.json";

const currentSections = new Map([
  ["Ph.D. Student", "Ph.D. Student"],
  ["Master Student", "Master Student"],
  ["Undergraduate Student", "Undergraduate Student"]
]);

function decodeHtml(value) {
  return String(value || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&ensp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripHtml(value) {
  return decodeHtml(value)
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/br>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
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

function normalizePath(value) {
  return decodeHtml(value || "").trim().replace(/^\/+/, "");
}

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function extractSections(html) {
  const pattern = /<font\s+size=["']?[56]["']?\s*>\s*<b>([\s\S]*?)<\/b>\s*<\/font>/gi;
  const headings = [...html.matchAll(pattern)].map((match) => ({
    title: stripHtml(match[1]),
    index: match.index
  }));
  return headings.map((heading, index) => {
    const end = headings[index + 1]?.index || html.length;
    return {
      title: heading.title,
      html: html.slice(heading.index, end)
    };
  });
}

function extractImage(html) {
  return normalizePath(html.match(/<img\b[^>]*src=["']([^"']+)["']/i)?.[1]);
}

function extractProfileUrl(html) {
  return normalizePath(html.match(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>\s*<img/i)?.[1]);
}

function extractPersonCells(html) {
  return [...html.matchAll(/<td\b[^>]*style=["'][^"']*text-align\s*:\s*center[^"']*["'][^>]*>[\s\S]*?<\/td>/gi)]
    .map((match) => match[0])
    .filter((cell) => /<strong>/i.test(cell));
}

function parseCurrentCell(cell, role) {
  const name = stripHtml(cell.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1]);
  if (!name) return null;
  const email = stripHtml(cell.match(/<p>\s*<font\b[^>]*>([\s\S]*?)<\/font>\s*<\/p>/i)?.[1]);
  return {
    name,
    role,
    email,
    image: extractImage(cell),
    profileUrl: extractProfileUrl(cell)
  };
}

function parseGraduateAlumniCell(cell) {
  const name = stripHtml(cell.match(/<strong>([\s\S]*?)<\/strong>/i)?.[1]);
  if (!name) return null;
  const fontValues = [...cell.matchAll(/<font\b[^>]*>([\s\S]*?)<\/font>/gi)].map((match) => stripHtml(match[1]));
  const email = fontValues[0] || "";
  const graduation = fontValues[1] || "";
  const gradMatch = graduation.match(/^([^,]+),\s*([^&]+?)(?:\s+&\s*(.*))?$/);
  return {
    name,
    email,
    year: clean(gradMatch?.[1] || ""),
    degree: clean(gradMatch?.[2] || ""),
    destination: clean(gradMatch?.[3] || ""),
    image: extractImage(cell),
    profileUrl: extractProfileUrl(cell)
  };
}

function parseUndergraduateAlumni(sectionHtml) {
  const paragraph = sectionHtml.match(/<p>\s*<font\b[^>]*>([\s\S]*?)<\/font>\s*<\/p>/i)?.[1] || "";
  return paragraph
    .split(/<br\s*\/?>/i)
    .map(stripHtml)
    .map(clean)
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(.+?)\s*\((.+?)\)$/);
      if (!match) return { name: line, degree: "BS" };
      const inner = match[2];
      const comma = inner.indexOf(",");
      const year = comma >= 0 ? inner.slice(0, comma) : "";
      const degreeAndDestination = comma >= 0 ? inner.slice(comma + 1) : inner;
      const arrow = degreeAndDestination.indexOf("->");
      const degree = arrow >= 0 ? degreeAndDestination.slice(0, arrow) : degreeAndDestination;
      const destination = arrow >= 0 ? degreeAndDestination.slice(arrow + 2) : "";
      return {
        name: clean(match[1]),
        year: clean(year),
        degree: clean(degree).replace("B.S.", "BS").replace("B.S", "BS"),
        destination: clean(destination)
      };
    });
}

function parseFaculty(sectionHtml) {
  const name = stripHtml(sectionHtml.match(/<strong>\s*<font\b[^>]*>([\s\S]*?)<\/font>\s*<\/strong>/i)?.[1]);
  if (!name) return [];
  const info = stripHtml(sectionHtml.match(/<font\s+style=["']font-size:\s*12pt["'][^>]*>([\s\S]*?)<\/font>/i)?.[1])
    .split("\n")
    .map(clean)
    .filter(Boolean);
  const [role = "", affiliation = "", addressLine = "", emailLine = ""] = info;
  return [
    {
      name,
      role,
      affiliation,
      address: addressLine.replace(/^Address:\s*/i, ""),
      email: emailLine.replace(/^Email:\s*/i, ""),
      image: extractImage(sectionHtml),
      profileUrl: normalizePath(sectionHtml.match(/<a\s+href\s*=\s*['"]?([^'">\s]+)['"]?/i)?.[1])
    }
  ];
}

function cleanPerson(person) {
  return Object.fromEntries(Object.entries(person).filter(([, value]) => String(value || "").trim()));
}

function mergeGroup(existing, legacy) {
  const byName = new Map();
  for (const person of legacy) byName.set(normalizeKey(person.name), cleanPerson(person));
  for (const person of existing || []) {
    const key = normalizeKey(person.name);
    byName.set(key, cleanPerson({ ...(byName.get(key) || {}), ...person }));
  }
  return [...byName.values()];
}

const html = await readFile(sourcePath, "utf8");
const existing = JSON.parse(await readFile(teamPath, "utf8"));
const next = {
  faculty: [],
  current: [],
  alumni: []
};

for (const section of extractSections(html)) {
  if (section.title === "Faculty") {
    next.faculty.push(...parseFaculty(section.html));
  } else if (currentSections.has(section.title)) {
    next.current.push(
      ...extractPersonCells(section.html)
        .map((cell) => parseCurrentCell(cell, currentSections.get(section.title)))
        .filter(Boolean)
    );
  } else if (section.title === "Graduate Alumni") {
    next.alumni.push(...extractPersonCells(section.html).map(parseGraduateAlumniCell).filter(Boolean));
  } else if (section.title === "Undergraduate Alumni") {
    next.alumni.push(...parseUndergraduateAlumni(section.html));
  }
}

const merged = {
  faculty: mergeGroup(existing.faculty, next.faculty),
  current: mergeGroup(existing.current, next.current),
  alumni: mergeGroup(existing.alumni, next.alumni)
};

await writeFile(teamPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(
  `Imported legacy team records: ${merged.faculty.length} faculty, ${merged.current.length} current, ${merged.alumni.length} alumni.`
);
