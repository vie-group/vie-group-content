import { mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";

const command = process.argv[2];
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
  ["image/webp", ".webp"],
  ["video/mp4", ".mp4"],
  ["video/quicktime", ".mov"]
]);

const defaultAttachmentExtensions = {
  code: ".zip",
  image: ".png",
  paper: ".pdf",
  slides: ".pptx",
  video: ".mp4"
};

function slugify(value) {
  const slug = String(value || "")
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

async function downloadGitHubAttachment(kind, sourceUrl, record) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "vie-group-seminar-asset-localizer"
    }
  });
  if (!response.ok) {
    throw new Error(`Could not download ${kind} attachment (${response.status}): ${sourceUrl}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (/^text\/html\b/i.test(contentType)) {
    throw new Error(`Attachment download returned HTML instead of a file: ${sourceUrl}`);
  }

  const year = record.date.slice(0, 4);
  const dir = `assets/seminars/${year}/${record.id}`;
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

function isOwnedSeminarAsset(value, id) {
  const path = String(value || "").replace(/^\/+/, "");
  return path.startsWith("assets/seminars/") && path.includes(`/${id}/`) && !path.split("/").includes("..");
}

async function pruneReplacedOwnedLinks(existing, nextLinks) {
  const retained = new Set(Object.values(nextLinks || {}).filter(Boolean).map((value) => String(value).replace(/^\/+/, "")));
  for (const value of Object.values(existing.links || {})) {
    const path = String(value || "").replace(/^\/+/, "");
    if (isOwnedSeminarAsset(path, existing.id) && !retained.has(path)) {
      await rm(path, { force: true });
      console.log(`Removed replaced seminar asset: ${path}`);
    }
  }
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

async function addSeminarFromIssue() {
  const bodyPath = process.env.ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const date = field(fields, "Date", true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD.");

  const title = field(fields, "Title", true);
  const speaker = field(fields, "Speaker", true);
  const rawLinks = {};
  for (const [key, label, attachmentLabel] of [
    ["image", "Image URL", "Image Attachment"],
    ["paper", "Paper URL", "Paper Attachment"],
    ["slides", "Slides URL", "Slides Attachment"],
    ["code", "Code URL"],
    ["video", "Video URL"]
  ]) {
    const value = field(fields, label) || firstUrl(field(fields, attachmentLabel));
    if (value) rawLinks[key] = value;
  }

  const id = `${date}-${slugify(title)}`;
  const links = await localizeAttachmentLinks(rawLinks, { date, id });
  const source =
    process.env.ISSUE_NUMBER && process.env.ISSUE_AUTHOR
      ? {
          type: "github-issue",
          repository: process.env.GITHUB_REPOSITORY || "vie-group/vie-group-content",
          issueNumber: Number(process.env.ISSUE_NUMBER),
          issueUrl: process.env.ISSUE_URL || "",
          author: process.env.ISSUE_AUTHOR
        }
      : null;

  const path = "data/seminars.json";
  const items = JSON.parse(await readFile(path, "utf8"));
  const existing = items.find((item) => item.id === id);
  if (existing && process.env.ISSUE_AUTHOR) {
    if (!existing.source?.author) {
      throw new Error(`Seminar ${id} already exists and has no GitHub issue source; update it through a maintainer PR.`);
    }
    if (existing.source.author !== process.env.ISSUE_AUTHOR) {
      throw new Error(`Seminar ${id} was submitted by @${existing.source.author}, not @${process.env.ISSUE_AUTHOR}.`);
    }
  }
  const record = {
    id,
    date,
    speaker,
    title,
    abstract: field(fields, "Abstract"),
    links,
    tags: splitTags(field(fields, "Tags"))
  };
  if (existing?.source) record.source = existing.source;
  else if (source) record.source = source;

  const next = [record, ...items.filter((item) => item.id !== record.id)].sort((a, b) =>
    String(b.date).localeCompare(String(a.date))
  );
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await writeOutput("id", record.id);
  await writeOutput("title", record.title);
  await writeOutput("speaker", record.speaker);
  console.log(`Prepared seminar PR data for ${record.id}`);
}

async function editSeminarFromIssue() {
  const bodyPath = process.env.ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const id = field(fields, "Original Seminar ID", true).trim();

  const date = field(fields, "Date", true);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Date must use YYYY-MM-DD.");

  const title = field(fields, "Title", true);
  const speaker = field(fields, "Speaker", true);
  const rawLinks = {};
  for (const [key, label, attachmentLabel] of [
    ["image", "Image URL", "Image Attachment"],
    ["paper", "Paper URL", "Paper Attachment"],
    ["slides", "Slides URL", "Slides Attachment"],
    ["code", "Code URL"],
    ["video", "Video URL"]
  ]) {
    const value = firstUrl(field(fields, attachmentLabel)) || field(fields, label);
    if (value) rawLinks[key] = value;
  }

  const path = "data/seminars.json";
  const items = JSON.parse(await readFile(path, "utf8"));
  const index = items.findIndex((item) => item.id === id);
  if (index < 0) throw new Error(`Seminar not found: ${id}`);

  const existing = items[index];
  const links = await localizeAttachmentLinks(rawLinks, { ...existing, date, id });
  await pruneReplacedOwnedLinks(existing, links);

  const record = {
    ...existing,
    date,
    speaker,
    title,
    abstract: field(fields, "Abstract"),
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
  const next = items.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  await writeFile(path, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  await writeOutput("id", record.id);
  await writeOutput("title", record.title);
  await writeOutput("speaker", record.speaker);
  console.log(`Prepared seminar edit PR data for ${record.id}`);
}

async function localizeExistingSeminars() {
  const path = "data/seminars.json";
  const items = JSON.parse(await readFile(path, "utf8"));
  let changed = false;
  for (const item of items) {
    if (!item.links || typeof item.links !== "object") continue;
    const links = await localizeAttachmentLinks(item.links, item);
    if (JSON.stringify(links) !== JSON.stringify(item.links)) {
      item.links = links;
      changed = true;
    }
  }
  if (changed) {
    await writeFile(path, `${JSON.stringify(items, null, 2)}\n`, "utf8");
    console.log("Localized existing seminar attachment links.");
  } else {
    console.log("No existing seminar attachment links to localize.");
  }
}

if (command === "seminar") {
  await addSeminarFromIssue();
} else if (command === "edit") {
  await editSeminarFromIssue();
} else if (command === "localize") {
  await localizeExistingSeminars();
} else {
  throw new Error("Usage: node scripts/issue-form-to-data.mjs seminar|edit|localize");
}
