import { appendFile, readFile, rm, writeFile } from "node:fs/promises";

const command = process.argv[2];
const seminarsPath = "data/seminars.json";

function slugify(value) {
  const slug = String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || `item-${Date.now()}`;
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

function field(fields, label) {
  return fields[normalizeLabel(label)] || "";
}

function issueNumberFrom(value) {
  const match = String(value || "").match(/(?:issues\/|#)?(\d+)/);
  return match ? match[1] : "";
}

function seminarIdFrom(fields) {
  const explicit = field(fields, "Seminar ID").trim();
  if (explicit) return explicit;

  const date = field(fields, "Date").trim();
  const title = field(fields, "Title").trim();
  if (date && title) return `${date}-${slugify(title)}`;
  return "";
}

function seminarIdFromOriginalIssue(body) {
  const fields = parseIssueForm(body);
  return seminarIdFrom(fields);
}

function assertSafeSeminarId(id) {
  if (!/^\d{4}-\d{2}-\d{2}-[a-z0-9-]+$/.test(id)) {
    throw new Error(`Unsafe or invalid seminar id: ${id}`);
  }
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

async function parseDeleteRequest() {
  const bodyPath = process.env.DELETE_ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("DELETE_ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const originalIssueNumber = issueNumberFrom(field(fields, "Original Seminar Issue Number"));
  if (!originalIssueNumber) {
    throw new Error("Original Seminar Issue Number is required.");
  }

  const requestedId = seminarIdFrom(fields);
  await writeOutput("original_issue_number", originalIssueNumber);
  await writeOutput("requested_id", requestedId);
  console.log(`Prepared seminar delete request for original issue #${originalIssueNumber}.`);
}

async function deleteSeminar() {
  const deleteBodyPath = process.env.DELETE_ISSUE_BODY_PATH;
  const originalBodyPath = process.env.ORIGINAL_ISSUE_BODY_PATH;
  const originalIssueNumber = issueNumberFrom(process.env.ORIGINAL_ISSUE_NUMBER);
  if (!deleteBodyPath) throw new Error("DELETE_ISSUE_BODY_PATH is required.");
  if (!originalBodyPath) throw new Error("ORIGINAL_ISSUE_BODY_PATH is required.");
  if (!originalIssueNumber) throw new Error("ORIGINAL_ISSUE_NUMBER is required.");

  const deleteFields = parseIssueForm(await readFile(deleteBodyPath, "utf8"));
  const requestedId = seminarIdFrom(deleteFields);
  const originalId = seminarIdFromOriginalIssue(await readFile(originalBodyPath, "utf8"));
  const id = requestedId || originalId;
  if (!id) {
    throw new Error("Could not determine seminar id from delete issue or original seminar issue.");
  }
  if (requestedId && originalId && requestedId !== originalId) {
    throw new Error(`Delete request seminar id (${requestedId}) does not match original issue seminar id (${originalId}).`);
  }
  assertSafeSeminarId(id);

  const items = JSON.parse(await readFile(seminarsPath, "utf8"));
  const record = items.find((item) => item.id === id);
  if (!record) {
    await writeOutput("id", id);
    await writeOutput("title", id);
    console.log(`Seminar already absent: ${id}`);
    return;
  }

  if (!record.source?.issueNumber) {
    throw new Error(`Seminar ${id} has no GitHub issue source; delete it through a maintainer PR.`);
  }
  if (String(record.source.issueNumber) !== originalIssueNumber) {
    throw new Error(`Seminar ${id} was recorded from issue #${record.source.issueNumber}, not #${originalIssueNumber}.`);
  }
  if (
    process.env.ORIGINAL_ISSUE_REPOSITORY &&
    record.source.repository &&
    record.source.repository !== process.env.ORIGINAL_ISSUE_REPOSITORY
  ) {
    throw new Error(
      `Seminar ${id} source repository ${record.source.repository} does not match verified repository ${process.env.ORIGINAL_ISSUE_REPOSITORY}.`
    );
  }
  if (process.env.ORIGINAL_ISSUE_AUTHOR && record.source.author && record.source.author !== process.env.ORIGINAL_ISSUE_AUTHOR) {
    throw new Error(`Seminar ${id} source author @${record.source.author} does not match original issue author @${process.env.ORIGINAL_ISSUE_AUTHOR}.`);
  }

  const next = items.filter((item) => item.id !== id);
  await writeFile(seminarsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  await rm(`assets/seminars/${record.date.slice(0, 4)}/${id}`, { recursive: true, force: true });

  await writeOutput("id", id);
  await writeOutput("title", record.title);
  console.log(`Deleted seminar: ${id}`);
}

if (command === "parse") {
  await parseDeleteRequest();
} else if (command === "delete") {
  await deleteSeminar();
} else {
  throw new Error("Usage: node scripts/delete-seminar-from-issue.mjs parse|delete");
}
