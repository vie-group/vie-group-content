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

function optionalGroup(value) {
  const group = String(value || "").trim().toLowerCase();
  if (!group) return "";
  if (!groups.includes(group)) throw new Error(`Group must be one of ${groups.join(", ")}.`);
  return group;
}

const changeAliases = {
  operation: ["operation", "op"],
  originalGroup: ["originalGroup", "og"],
  originalName: ["originalName", "on"],
  targetGroup: ["targetGroup", "tg"],
  name: ["name", "n"],
  role: ["role", "r"],
  email: ["email", "e"],
  affiliation: ["affiliation", "af"],
  address: ["address", "ad"],
  year: ["year", "y"],
  degree: ["degree", "deg"],
  destination: ["destination", "dst"],
  imageUrl: ["imageUrl", "img"],
  profileUrl: ["profileUrl", "p"]
};

function changeKeys(key) {
  return changeAliases[key] || [key];
}

function changeValue(change, key) {
  for (const currentKey of changeKeys(key)) {
    if (Object.prototype.hasOwnProperty.call(change || {}, currentKey)) return cleanValue(change[currentKey]);
  }
  return "";
}

function hasOwnValue(change, key) {
  return changeKeys(key).some((currentKey) => Object.prototype.hasOwnProperty.call(change || {}, currentKey));
}

function degreeFromRole(role) {
  const normalized = String(role || "").toLowerCase();
  if (normalized.includes("ph.d") || normalized.includes("phd")) return "PhD";
  if (normalized.includes("master")) return "MS";
  if (normalized.includes("undergraduate") || normalized.includes("bachelor")) return "BS";
  return "";
}

function parseBatchChanges(value) {
  const text = cleanValue(value);
  if (!text) return [];
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`Batch Changes must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(parsed)) throw new Error("Batch Changes must be a JSON array.");
  if (parsed.length === 0) throw new Error("Batch Changes must include at least one change.");
  if (parsed.length > 100) throw new Error("Batch Changes supports at most 100 changes per issue.");
  return parsed;
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

function teamRecordFromChange(change, targetGroup, image, existing = {}) {
  const nextName = changeValue(change, "name") || existing.name;
  if (!nextName) throw new Error("Batch change name is required.");
  const common = {
    name: nextName,
    email: hasOwnValue(change, "email") ? changeValue(change, "email") : existing.email,
    image,
    profileUrl: hasOwnValue(change, "profileUrl") ? changeValue(change, "profileUrl") : existing.profileUrl
  };
  if (targetGroup === "faculty") {
    return cleanPerson({
      ...common,
      role: changeValue(change, "role") || existing.role || existing.degree,
      affiliation: hasOwnValue(change, "affiliation") ? changeValue(change, "affiliation") : existing.affiliation,
      address: hasOwnValue(change, "address") ? changeValue(change, "address") : existing.address
    });
  }
  if (targetGroup === "current") {
    return cleanPerson({
      ...common,
      role: changeValue(change, "role") || existing.role || existing.degree
    });
  }
  return cleanPerson({
    ...common,
    year: changeValue(change, "year") || existing.year,
    degree: changeValue(change, "degree") || existing.degree || degreeFromRole(existing.role),
    destination: hasOwnValue(change, "destination") ? changeValue(change, "destination") : existing.destination
  });
}

async function applySingleChange(team, change, fallbackFields = null) {
  const operation = (changeValue(change, "operation") || "update").toLowerCase();
  if (!["add", "update", "delete"].includes(operation)) throw new Error("Operation must be add, update, or delete.");
  const originalName = changeValue(change, "originalName");
  const originalGroup = optionalGroup(changeValue(change, "originalGroup"));
  const targetGroup = operation === "delete" ? "" : normalizeGroup(changeValue(change, "targetGroup"));

  const removed = operation === "add" ? null : removePerson(team, originalGroup, originalName || changeValue(change, "name"));
  if (operation !== "add" && !removed) {
    throw new Error(`Team member not found: ${originalGroup ? `${originalGroup}/` : ""}${originalName || changeValue(change, "name")}`);
  }

  if (operation === "delete") {
    if (removed?.person?.image && isOwnedTeamAsset(removed.person.image, removed.person.name)) {
      await rm(removed.person.image, { force: true });
      console.log(`Removed team image asset: ${removed.person.image}`);
    }
    return {
      name: originalName || removed?.person?.name || "",
      operation
    };
  }

  let image;
  if (fallbackFields) {
    image = firstUrl(field(fallbackFields, "Image Attachment")) || field(fallbackFields, "Image URL");
  } else if (hasOwnValue(change, "imageUrl")) {
    image = changeValue(change, "imageUrl");
  } else {
    image = removed?.person?.image || "";
  }

  const nextName = changeValue(change, "name") || removed?.person?.name || "";
  if (!nextName) throw new Error("Name is required.");
  if (isGitHubAttachmentUrl(image)) image = await downloadImageAttachment(image, nextName);
  if (removed?.person?.image && removed.person.image !== image && isOwnedTeamAsset(removed.person.image, removed.person.name)) {
    await rm(removed.person.image, { force: true });
    console.log(`Removed replaced team image asset: ${removed.person.image}`);
  }

  const record = fallbackFields
    ? teamRecordForGroup(fallbackFields, targetGroup, image)
    : teamRecordFromChange(change, targetGroup, image, removed?.person || {});
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

  return {
    name: record.name,
    operation
  };
}

async function editTeamFromIssue() {
  const bodyPath = process.env.ISSUE_BODY_PATH;
  if (!bodyPath) throw new Error("ISSUE_BODY_PATH is required.");
  const fields = parseIssueForm(await readFile(bodyPath, "utf8"));
  const batchChanges = parseBatchChanges(field(fields, "Batch Changes"));

  const path = "data/team.json";
  const team = JSON.parse(await readFile(path, "utf8"));
  for (const group of groups) team[group] = team[group] || [];

  if (batchChanges.length > 0) {
    const results = [];
    for (const change of batchChanges) {
      results.push(await applySingleChange(team, change));
    }
    await writeFile(path, `${JSON.stringify(team, null, 2)}\n`, "utf8");
    await writeOutput("name", `${results.length} team members`);
    await writeOutput("operation", "batch");
    console.log(`Prepared team batch PR data for ${results.length} change(s)`);
    return;
  }

  const singleChange = {
    operation: field(fields, "Operation", true),
    originalGroup: field(fields, "Original Group"),
    originalName: field(fields, "Original Name"),
    targetGroup: field(fields, "Target Group"),
    name: field(fields, "Name"),
    role: field(fields, "Role"),
    email: field(fields, "Email"),
    affiliation: field(fields, "Affiliation"),
    address: field(fields, "Address"),
    year: field(fields, "Year"),
    degree: field(fields, "Degree"),
    destination: field(fields, "Destination"),
    imageUrl: field(fields, "Image URL"),
    profileUrl: field(fields, "Profile URL")
  };
  const result = await applySingleChange(team, singleChange, fields);
  await writeFile(path, `${JSON.stringify(team, null, 2)}\n`, "utf8");
  await writeOutput("name", result.name);
  await writeOutput("operation", result.operation);
  console.log(`Prepared team ${result.operation} PR data for ${result.name}`);
}

await editTeamFromIssue();
