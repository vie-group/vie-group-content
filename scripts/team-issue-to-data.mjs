import { mkdir, readFile, writeFile, appendFile, rm } from "node:fs/promises";

const groups = ["faculty", "current", "alumni"];
const attachmentContentTypes = new Map([
  ["image/gif", ".gif"],
  ["image/jpeg", ".jpg"],
  ["image/png", ".png"],
  ["image/svg+xml", ".svg"],
  ["image/webp", ".webp"]
]);

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

function field(fields, label, required = false) {
  const value = fields[normalizeLabel(label)] || "";
  if (required && !value) throw new Error(`${label} is required in the issue form.`);
  return value;
}

function firstUrl(value) {
  const match = String(value || "").match(/https?:\/\/[^\s"'<>()[\]]+/);
  return match ? match[0].replace(/[.,;"']+$/, "") : "";
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
  return slug || "person";
}

function normalizeGroup(value) {
  const group = String(value || "").trim().toLowerCase();
  if (!groups.includes(group)) throw new Error(`Group must be one of ${groups.join(", ")}.`);
  return group;
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

function isOwnedTeamAsset(value, name) {
  const path = String(value || "").replace(/^\/+/, "");
  return path.startsWith("assets/team/") && path.includes(`/${slugify(name)}/`) && !path.split("/").includes("..");
}

async function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  await appendFile(process.env.GITHUB_OUTPUT, `${name}=${String(value || "")}\n`);
}

async function downloadImageAttachment(sourceUrl, personName) {
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: {
      "User-Agent": "vie-group-team-asset-localizer"
    }
  });
  if (!response.ok) throw new Error(`Could not download image attachment (${response.status}): ${sourceUrl}`);
  const contentType = response.headers.get("content-type") || "";
  if (/^text\/html\b/i.test(contentType)) {
    throw new Error(`Attachment download returned HTML instead of an image: ${sourceUrl}`);
  }

  const cleanContentType = contentType.split(";")[0].trim().toLowerCase();
  const url = new URL(sourceUrl);
  const pathFilename = url.pathname.split("/").filter(Boolean).pop() || "";
  const extension =
    extensionFromFilename(pathFilename) ||
    extensionFromFilename(filenameFromContentDisposition(response.headers.get("content-disposition"))) ||
    attachmentContentTypes.get(cleanContentType) ||
    ".png";
  const dir = `assets/team/${slugify(personName)}`;
  const path = `${dir}/image${extension}`;
  await mkdir(dir, { recursive: true });
  await writeFile(path, Buffer.from(await response.arrayBuffer()));
  console.log(`Downloaded team image attachment to ${path}`);
  return path;
}

function removePerson(team, group, name) {
  const key = normalizeKey(name);
  if (!key) return null;
  const searchGroups = group ? [group] : groups;
  for (const currentGroup of searchGroups) {
    const index = (team[currentGroup] || []).findIndex((person) => normalizeKey(person.name) === key);
    if (index >= 0) {
      const [person] = team[currentGroup].splice(index, 1);
      return { person, group: currentGroup, index };
    }
  }
  return null;
}

function cleanPerson(person) {
  return Object.fromEntries(
    Object.entries(person).filter(([, value]) => {
      if (value === null || value === undefined) return false;
      return String(value).trim() !== "";
    })
  );
}

function teamRecordForGroup(fields, targetGroup, image) {
  const common = {
    name: field(fields, "Name", true),
    email: field(fields, "Email"),
    image,
    profileUrl: field(fields, "Profile URL")
  };
  if (targetGroup === "faculty") {
    return cleanPerson({
      ...common,
      role: field(fields, "Role"),
      affiliation: field(fields, "Affiliation"),
      address: field(fields, "Address")
    });
  }
  if (targetGroup === "current") {
    return cleanPerson({
      ...common,
      role: field(fields, "Role")
    });
  }
  return cleanPerson({
    ...common,
    year: field(fields, "Year"),
    degree: field(fields, "Degree"),
    destination: field(fields, "Destination")
  });
}

async function editTeamFromIssue() {
  const bodyPath = process.env.ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const operation = (field(fields, "Operation", true) || "update").trim().toLowerCase();
  if (!["add", "update", "delete"].includes(operation)) throw new Error("Operation must be add, update, or delete.");
  const originalName = field(fields, "Original Name");
  const originalGroupRaw = field(fields, "Original Group");
  const originalGroup = originalGroupRaw ? normalizeGroup(originalGroupRaw) : "";
  const targetGroup = operation === "delete" ? "" : normalizeGroup(field(fields, "Target Group", true));

  const path = "data/team.json";
  const team = JSON.parse(await readFile(path, "utf8"));
  for (const group of groups) team[group] = team[group] || [];

  const removed = operation === "add" ? null : removePerson(team, originalGroup, originalName || field(fields, "Name", true));
  if (operation !== "add" && !removed) {
    throw new Error(`Team member not found: ${originalGroup ? `${originalGroup}/` : ""}${originalName}`);
  }

  if (operation === "delete") {
    if (removed?.person?.image && isOwnedTeamAsset(removed.person.image, removed.person.name)) {
      await rm(removed.person.image, { force: true });
      console.log(`Removed team image asset: ${removed.person.image}`);
    }
    await writeFile(path, `${JSON.stringify(team, null, 2)}\n`, "utf8");
    await writeOutput("name", originalName || removed?.person?.name || "");
    await writeOutput("operation", operation);
    return;
  }

  let image = firstUrl(field(fields, "Image Attachment")) || field(fields, "Image URL");
  const nextName = field(fields, "Name", true);
  if (isGitHubAttachmentUrl(image)) image = await downloadImageAttachment(image, nextName);
  if (removed?.person?.image && removed.person.image !== image && isOwnedTeamAsset(removed.person.image, removed.person.name)) {
    await rm(removed.person.image, { force: true });
    console.log(`Removed replaced team image asset: ${removed.person.image}`);
  }

  const record = teamRecordForGroup(fields, targetGroup, image);
  if (operation === "add") {
    const duplicate = removePerson(team, targetGroup, record.name);
    if (duplicate?.person?.image && duplicate.person.image !== image && isOwnedTeamAsset(duplicate.person.image, duplicate.person.name)) {
      await rm(duplicate.person.image, { force: true });
    }
  }

  if (removed && removed.group === targetGroup) {
    team[targetGroup].splice(Math.min(removed.index, team[targetGroup].length), 0, record);
  } else {
    team[targetGroup].push(record);
  }

  await writeFile(path, `${JSON.stringify(team, null, 2)}\n`, "utf8");
  await writeOutput("name", record.name);
  await writeOutput("operation", operation);
  console.log(`Prepared team ${operation} PR data for ${record.name}`);
}

await editTeamFromIssue();
