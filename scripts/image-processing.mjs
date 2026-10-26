import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, extname, join } from "node:path";
import { spawn } from "node:child_process";

const processableImageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const processableContentTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const pdfExtensions = new Set([".pdf"]);
const presentationExtensions = new Set([".ppt", ".pptx", ".pptm"]);

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

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
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

async function presentationCommand() {
  if (await commandWorks("soffice", ["--version"])) return "soffice";
  if (await commandWorks("libreoffice", ["--version"])) return "libreoffice";
  return "";
}

async function compressCoverImage(inputPath, outputPath) {
  const magick = await imageMagickCommand();
  if (!magick) {
    const buffer = await readFile(inputPath);
    await writeFile(outputPath, buffer);
    return;
  }
  await run(magick.command, [...magick.prefixArgs, inputPath, ...imagePresetArgs("seminar-cover"), outputPath]);
}

async function convertPresentationToPdf(sourcePath, outputDir) {
  const command = await presentationCommand();
  if (!command) throw new Error("LibreOffice is not available for PPT/PPTX rendering.");

  await mkdir(outputDir, { recursive: true });
  await run(command, ["--headless", "--convert-to", "pdf", "--outdir", outputDir, sourcePath]);

  const expected = join(outputDir, `${basename(sourcePath, extname(sourcePath))}.pdf`);
  if (await pathExists(expected)) return expected;

  const files = await readdir(outputDir);
  const generated = files.find((file) => file.toLowerCase().endsWith(".pdf"));
  if (!generated) throw new Error(`LibreOffice did not generate a PDF for ${sourcePath}.`);
  return join(outputDir, generated);
}

async function renderPdfFirstPage(sourcePath, outputPath, workDir) {
  if (await commandWorks("pdftoppm", ["-v"])) {
    const prefix = join(workDir, "page");
    await run("pdftoppm", ["-f", "1", "-l", "1", "-singlefile", "-jpeg", "-r", "150", sourcePath, prefix]);
    const pagePath = `${prefix}.jpg`;
    if (!(await pathExists(pagePath))) throw new Error(`pdftoppm did not generate ${pagePath}.`);
    await compressCoverImage(pagePath, outputPath);
    return;
  }

  const magick = await imageMagickCommand();
  if (!magick) throw new Error("Neither pdftoppm nor ImageMagick is available for PDF rendering.");
  await run(magick.command, [...magick.prefixArgs, "-density", "150", `${sourcePath}[0]`, ...imagePresetArgs("seminar-cover"), outputPath]);
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

export async function generateDocumentCover({ sourcePath, outputPath, label }) {
  const extension = extname(String(sourcePath || "")).toLowerCase();
  if (!pdfExtensions.has(extension) && !presentationExtensions.has(extension)) return false;

  const dir = await mkdtemp(join(tmpdir(), "vie-cover-"));
  const tempOutput = join(dir, "cover.jpg");
  try {
    const pdfPath = pdfExtensions.has(extension) ? sourcePath : await convertPresentationToPdf(sourcePath, join(dir, "pdf"));
    await renderPdfFirstPage(pdfPath, tempOutput, dir);
    const output = await readFile(tempOutput);
    await writeFile(outputPath, output);
    console.log(`Generated ${label || "document cover"}: ${sourcePath} -> ${outputPath} (${output.length} bytes)`);
    return true;
  } catch (error) {
    console.warn(`Could not generate ${label || "document cover"} from ${sourcePath}: ${error.message}`);
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
