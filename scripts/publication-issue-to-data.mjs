import { mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";

const attachmentContentTypes = new Map([
  ["application/pdf", ".pdf"],
  ["application/zip", ".zip"],
  ["application/x-zip-compressed", ".zip"],
  ["application/vnd.ms-powerpoint", ".ppt"],
  ["application/vnd.openxmlformats-officedocument.presentationml.presentation", ".pptx"],
  ["application/vnd.ms-powerpoint.presentation.macroenabled.12", ".pptm"],
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/webp", ".webp"]
]);

const defaultAttachmentExtensions = {
  code: ".zip",
  pdf: ".pdf",
  poster: ".pdf",
  slide: ".pptx"
};

function normalizeLabel(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cleanValue(value) {
  const cleaned = String(value || "")
    .replace(/<!--.*?-->/gs, "")
    .replace(/^_No response_$/gm, "")
    .trim();
  return cleaned === "_No response_" ? "" : cleaned;
}

function firstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>()[\]]+/);
  return match ? match[0].replace(/[.,;"']+$/, "") : "";
}

function splitTags(value) {
  return String(value || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseIssueForm(body) {
  const fields = {};
  let current = null;
  for (const line of String(body || "").split(/\r?\n/)) {
    const header = line.match(/^###\s+(.+?)\s*$/);
    if (header) {
      current = normalizeLabel(header[1]);
      fields[current] = [];
      continue;
    }
    if (current) fields[current].push(line);
  }
  return Object.fromEntries(Object.entries(fields).map(([key, lines]) => [key, cleanValue(lines.join("\n"))]));
}

function field(fields, label, required = false) {
  const value = fields[normalizeLabel(label)] || "";
  if (required && !value) throw new Error(`${label} is required in the issue form.`);
  return value;
}

function isGitHubAttachmentUrl(value) {
  try {
    const url = new URL(value);
    return (
      (url.hostname === "github.com" && url.pathname.startsWith("/user-attachments/")) ||
      url.hostname === "user-images.githubusercontent.com"
    );
  } catch {
    return false;
  }
}

function extensionFromFilename(value) {
  const decoded = decodeURIComponent(String(value || ""));
  const match = decoded.match(/\.([a-z0-9]{1,12})$/i);
  return match ? `.${match[1].toLowerCase()}` : "";
}

function filenameFromContentDisposition(value) {
  const header = String(value || "");
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) return decodeURIComponent(encoded[1].replace(/^"|"$/g, ""));
  const plain = header.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : "";
}

function attachmentExtension(kind, sourceUrl, contentType, contentDisposition) {
  const url = new URL(sourceUrl);
  const pathFilename = url.pathname.split("/").filter(Boolean).pop() || "";
  return (
    extensionFromFilename(pathFilename) ||
    extensionFromFilename(filenameFromContentDisposition(contentDisposition)) ||
    attachmentContentTypes.get(String(contentType || "").split(";")[0].trim().toLowerCase()) ||
    defaultAttachmentExtensions[kind] ||
    ".bin"
  );
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  const safeValue = String(value || "");
  if (safeValue.includes("\n")) {
    const marker = `EOF_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    await appendFile(process.env.GITHUB_OUTPUT, `${name}<<${marker}\n${safeValue}\n${marker}\n`);
  } else {
    await appendFile(process.env.GITHUB_OUTPUT, `${name}=${safeValue}\n`);
  }
}

async function downloadGitHubAttachment(kind, sourceUrl, record) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "vie-group-publication-asset-localizer"
    }
  });
  if (!response.ok) {
    throw new Error(`Could not download ${kind} attachment (${response.status}): ${sourceUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (/^text\/html\b/i.test(contentType)) {
    throw new Error(`Attachment download returned HTML instead of a file: ${sourceUrl}`);
  }

  const dir = `assets/publications/${record.year}/${record.id}`;
  const extension = attachmentExtension(kind, sourceUrl, contentType, response.headers.get("content-disposition"));
  const path = `${dir}/${kind}${extension}`;
  const bytes = Buffer.from(await response.arrayBuffer());

  await mkdir(dir, { recursive: true });
  await writeFile(path, bytes);
  console.log(`Downloaded ${kind} attachment to ${path}`);
  return path;
}

async function localizeAttachmentLinks(links, record) {
  const localized = {};
  for (const [key, value] of Object.entries(links)) {
    localized[key] = isGitHubAttachmentUrl(value) ? await downloadGitHubAttachment(key, value, record) : value;
  }
  return localized;
}

function isOwnedPublicationAsset(value, id) {
  const path = String(value || "").replace(/^\/+/, "");
  return path.startsWith("assets/publications/") && path.includes(`/${id}/`) && !path.split("/").includes("..");
}

async function pruneReplacedOwnedLinks(existing, nextLinks) {
  const retained = new Set(Object.values(nextLinks || {}).filter(Boolean).map((value) => String(value).replace(/^\/+/, "")));
  for (const value of Object.values(existing.links || {})) {
    const path = String(value || "").replace(/^\/+/, "");
    if (isOwnedPublicationAsset(path, existing.id) && !retained.has(path)) {
      await rm(path, { force: true });
      console.log(`Removed replaced publication asset: ${path}`);
    }
  }
}

async function editPublicationFromIssue() {
  const bodyPath = process.env.ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const id = field(fields, "Original Publication ID", true).trim();

  const year = Number(field(fields, "Year", true));
  if (!Number.isInteger(year)) throw new Error("Year must be an integer.");

  const type = field(fields, "Type", true).trim().toLowerCase();
  if (!["conference", "journal", "dataset"].includes(type)) throw new Error("Type must be conference, journal, or dataset.");

  const title = field(fields, "Title", true);
  const authors = field(fields, "Authors", true);
  const venue = field(fields, "Venue", true);
  const rawLinks = {};
  for (const [key, label, attachmentLabel] of [
    ["pdf", "PDF URL", "PDF Attachment"],
    ["slide", "Slide URL", "Slide Attachment"],
    ["poster", "Poster URL", "Poster Attachment"],
    ["code", "Code URL", "Code Attachment"]
  ]) {
    const value = firstUrl(field(fields, attachmentLabel)) || field(fields, label);
    if (value) rawLinks[key] = value;
  }

  const path = "data/publications.json";
  const items = JSON.parse(await readFile(path, "utf8"));
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Publication not found: ${id}`);

  const existing = items[index];
  const links = await localizeAttachmentLinks(rawLinks, { ...existing, year, id });
  await pruneReplacedOwnedLinks(existing, links);

  const record = {
    ...existing,
    type,
    year,
    authors,
    title,
    venue,
    note: field(fields, "Note"),
    links,
    tags: splitTags(field(fields, "Tags")),
    lastEdit:
      process.env.ISSUE_NUMBER && process.env.ISSUE_AUTHOR
        ? {
            type: "github-issue",
            repository: process.env.GITHUB_REPOSITORY || "vie-group/vie-group-content",
            issueNumber: Number(process.env.ISSUE_NUMBER),
            issueUrl: process.env.ISSUE_URL || "",
            author: process.env.ISSUE_AUTHOR
          }
        : existing.lastEdit
  };

  items[index] = record;
  const next = items.sort(
    (a, b) => Number(b.year || 0) - Number(a.year || 0) || String(a.title).localeCompare(String(b.title))
  );
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await writeOutput("id", record.id);
  await writeOutput("title", record.title);
  console.log(`Prepared publication edit PR data for ${record.id}`);
}

await editPublicationFromIssue();
