import { createReadStream, createWriteStream } from "node:fs";
import { basename, dirname, extname, join } from "node:path";

const input = process.argv[2];
const rawTargets = process.argv.slice(3);

if (!input || rawTargets.length === 0) {
  console.error("Usage: node scripts/split-json-array.mjs <input.json> <sizeMB>...");
  process.exit(1);
}

const outputDir = dirname(input);
const extension = extname(input);
const stem = basename(input, extension);
const targets = rawTargets.map((value) => {
  const sizeMb = Number(value);
  if (!Number.isFinite(sizeMb) || sizeMb <= 0) {
    throw new Error(`Invalid size: ${value}`);
  }
  return { label: `${sizeMb}MB`, bytes: Math.floor(sizeMb * 1024 * 1024) };
});

let targetIndex = 0;
let writer = null;
let currentBytes = 0;
let firstObjectInFile = true;
let objectsInFile = 0;
const results = [];

let inString = false;
let escapeNext = false;
let objectDepth = 0;
let insideObject = false;

function outputPathForTarget(target) {
  return join(outputDir, `${stem}-${target.label}${extension}`);
}

async function write(buffer) {
  if (!writer || buffer.length === 0) return;
  currentBytes += buffer.length;
  if (!writer.write(buffer)) {
    await new Promise((resolve) => writer.once("drain", resolve));
  }
}

async function openOutput() {
  const target = targets[targetIndex];
  writer = createWriteStream(outputPathForTarget(target), { flags: "w" });
  currentBytes = 0;
  firstObjectInFile = true;
  objectsInFile = 0;
  await write(Buffer.from("[\n"));
}

async function closeOutput() {
  if (!writer) return;
  await write(Buffer.from("\n]\n"));
  const target = targets[targetIndex];
  const path = outputPathForTarget(target);
  const bytes = currentBytes;
  const objects = objectsInFile;
  await new Promise((resolve, reject) => {
    writer.end((error) => (error ? reject(error) : resolve()));
  });
  results.push({ path, bytes, objects });
  writer = null;
  targetIndex += 1;
}

async function startObject() {
  if (!writer) {
    await openOutput();
  }

  if (!firstObjectInFile) {
    await write(Buffer.from(",\n"));
  }

  firstObjectInFile = false;
  insideObject = true;
  objectDepth = 0;
}

async function finishObject() {
  objectsInFile += 1;
  insideObject = false;
  objectDepth = 0;

  if (currentBytes >= targets[targetIndex].bytes) {
    await closeOutput();
  }
}

for await (const chunk of createReadStream(input, { highWaterMark: 1024 * 1024 })) {
  if (targetIndex >= targets.length) break;

  let segmentStart = insideObject ? 0 : -1;

  for (let index = 0; index < chunk.length; index += 1) {
    const byte = chunk[index];

    if (!insideObject) {
      if (byte === 0x7b) {
        await startObject();
        segmentStart = index;
        objectDepth = 1;
      }
      continue;
    }

    if (inString) {
      if (escapeNext) {
        escapeNext = false;
      } else if (byte === 0x5c) {
        escapeNext = true;
      } else if (byte === 0x22) {
        inString = false;
      }
      continue;
    }

    if (byte === 0x22) {
      inString = true;
      continue;
    }

    if (byte === 0x7b || byte === 0x5b) {
      objectDepth += 1;
      continue;
    }

    if (byte === 0x7d || byte === 0x5d) {
      objectDepth -= 1;
      if (objectDepth === 0) {
        await write(chunk.subarray(segmentStart, index + 1));
        await finishObject();
        segmentStart = -1;
        if (targetIndex >= targets.length) break;
      }
    }
  }

  if (targetIndex >= targets.length) break;

  if (insideObject && segmentStart >= 0) {
    await write(chunk.subarray(segmentStart));
  }
}

if (writer) {
  await closeOutput();
}

for (const result of results) {
  console.log(`${result.path}\t${(result.bytes / 1024 / 1024).toFixed(2)} MiB\t${result.objects} objects`);
}
