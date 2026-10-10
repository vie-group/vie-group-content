import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

const processableImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const processableContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function cleanContentType(value) {
  return String(value || "").split(";")[0].trim().toLowerCase();
}

function imagePresetArgs(preset) {
  if (preset === "team-portrait") {
    return [
      "-auto-orient",
      "-resize",
      "280x320^",
      "-gravity",
      "center",
      "-extent",
      "280x320",
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      "-interlace",
      "Plane",
      "-quality",
      "82"
    ];
  }
  if (preset === "seminar-cover") {
    return [
      "-auto-orient",
      "-resize",
      "640x640>",
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      "-interlace",
      "Plane",
      "-quality",
      "82"
    ];
  }
  return null;
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${code}: ${stderr.trim()}`));
    });
  });
}

async function commandWorks(command, args) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

async function imageMagickCommand() {
  if (await commandWorks("magick", ["-version"])) return { command: "magick", prefixArgs: [] };
  if (await commandWorks("convert", ["-version"])) return { command: "convert", prefixArgs: [] };
  return null;
}

export async function processImageAttachment({ buffer, extension, contentType, preset, label }) {
  const normalizedExtension = String(extension || "").toLowerCase();
  const normalizedContentType = cleanContentType(contentType);
  const args = imagePresetArgs(preset);
  if (
    !args ||
    (!processableImageExtensions.has(normalizedExtension) && !processableContentTypes.has(normalizedContentType))
  ) {
    return { buffer, extension };
  }

  const magick = await imageMagickCommand();
  if (!magick) {
    console.warn(`ImageMagick is not available; keeping original image for ${label || "attachment"}.`);
    return { buffer, extension };
  }

  const dir = await mkdtemp(join(tmpdir(), "vie-image-"));
  const inputPath = join(dir, `input${normalizedExtension || ".img"}`);
  const outputPath = join(dir, "output.jpg");
  try {
    await writeFile(inputPath, buffer);
    await run(magick.command, [...magick.prefixArgs, inputPath, ...args, outputPath]);
    const output = await readFile(outputPath);
    console.log(
      `Processed ${label || "image attachment"}: ${buffer.length} bytes -> ${output.length} bytes (${preset})`
    );
    return { buffer: output, extension: ".jpg" };
  } catch (error) {
    console.warn(`Could not process ${label || "image attachment"}; keeping original file. ${error.message}`);
    return { buffer, extension };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
