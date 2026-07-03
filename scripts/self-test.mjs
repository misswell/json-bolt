import { access, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import vm from "node:vm";

const root = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const releaseZip = join(root, "release/JsonBolt-0.1.1-chrome.zip");
const largeFixture = "/Users/guofeng/Downloads/latest-lexemes-100MB.json";
const targetHash = "933da7d7f0c5783541c8e80053ff55ec63b252fe";

function assert(condition, message, detail = "") {
  if (!condition) {
    throw new Error(`${message}${detail ? `: ${detail}` : ""}`);
  }
}

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} ${args.join(" ")} failed (${code})\n${stdout}\n${stderr}`));
    });
  });
}

async function findBuiltWorker() {
  const assetsDir = join(root, "dist/assets");
  const files = await readdir(assetsDir);
  const workerFiles = files.filter((file) => /^jsonParser\.worker-.+\.js$/.test(file));
  assert(workerFiles.length === 1, "expected exactly one built worker asset", String(workerFiles.length));
  return join(assetsDir, workerFiles[0]);
}

async function createWorkerHarness() {
  const responses = [];
  const self = {
    postMessage(response) {
      responses.push(response);
    }
  };
  const context = vm.createContext({
    self,
    Blob,
    TextDecoder,
    Uint8Array,
    ArrayBuffer,
    Map,
    Set,
    Math,
    Error,
    RangeError,
    JSON,
    RegExp,
    Promise,
    String,
    Number,
    Boolean
  });

  vm.runInContext(await readFile(await findBuiltWorker(), "utf8"), context);

  async function request(message) {
    const start = responses.length;
    await self.onmessage({ data: message });
    await new Promise((resolve) => setTimeout(resolve, 0));
    return responses.slice(start);
  }

  return { request };
}

function visibleNodes(rootIds, nodesById, expandedIds) {
  const result = [];
  const stack = [...rootIds].reverse();

  while (stack.length > 0) {
    const id = stack.pop();
    const node = nodesById.get(id);
    if (!node) continue;

    result.push(node);

    if (expandedIds.has(id) && node.children) {
      for (let index = node.children.length - 1; index >= 0; index -= 1) {
        stack.push(node.children[index]);
      }
    }
  }

  return result;
}

function revealNode(id, nodesById, expandedIds) {
  const next = new Set(expandedIds);
  let node = nodesById.get(id);

  while (node?.parentId !== null && node?.parentId !== undefined) {
    next.add(node.parentId);
    node = nodesById.get(node.parentId);
  }

  return next;
}

const checks = [];
const skipped = [];

async function check(name, fn) {
  await fn();
  checks.push(name);
}

await check("worker parses valid JSON and creates root/child nodes", async () => {
  const worker = await createWorkerHarness();
  const source = JSON.stringify([
    { id: "L4", claims: { P9764: [{ hash: targetHash }] } },
    { id: "L5", claims: { P9764: [{ hash: "other" }] } }
  ]);
  const responses = await worker.request({ type: "parse", text: source, requestId: 1 });
  const success = responses.find((item) => item.type === "success");
  assert(success, "parse success missing");
  assert(success.nodes.length >= 3, "parse did not create root and array item nodes", String(success.nodes.length));
  assert(success.nodes[0].type === "array", "root node is not array");
});

await check("worker source search finds deep value before node expansion", async () => {
  const worker = await createWorkerHarness();
  const source = JSON.stringify([
    { id: "L4", claims: { P9764: [{ hash: targetHash }] } },
    { id: "L5", claims: { P9764: [{ hash: "other" }] } }
  ]);
  await worker.request({ type: "parse", text: source, requestId: 2 });
  const responses = await worker.request({
    type: "search",
    requestId: 2,
    query: targetHash,
    limit: 20
  });
  const result = responses.find((item) => item.type === "search");
  assert(result, "search response missing");
  assert(result.matches.length >= 1, "deep value search returned no matches");
});

await check("worker expands lazy object children", async () => {
  const worker = await createWorkerHarness();
  const source = JSON.stringify([{ id: "L4", claims: { P9764: [{ hash: "target" }] } }]);
  const parseResponses = await worker.request({ type: "parse", text: source, requestId: 3 });
  const success = parseResponses.find((item) => item.type === "success");
  const firstItem = success.nodes.find((node) => node.key === "0");
  assert(firstItem?.valueStart !== undefined, "first array item missing offset");
  const expandResponses = await worker.request({
    type: "expand",
    requestId: 3,
    nodeId: firstItem.id,
    valueStart: firstItem.valueStart,
    depth: firstItem.depth
  });
  const expanded = expandResponses.find((item) => item.type === "expanded");
  assert(expanded, "expand response missing");
  assert(expanded.children.some((node) => node.key === "claims"), "expanded children missing claims");
});

await check("worker rejects trailing JSON content", async () => {
  const worker = await createWorkerHarness();
  const responses = await worker.request({ type: "parse", text: "{\"a\":1}\n{\"b\":2}", requestId: 4 });
  const error = responses.find((item) => item.type === "error");
  assert(error, "invalid trailing content did not produce error");
  assert(String(error.message).includes("trailing"), "unexpected error message", String(error.message));
});

await check("search navigation reveals target after expand changes visible rows", async () => {
  const nodes = [
    { id: 0, parentId: null, children: [1, 4], childCount: 2 },
    { id: 1, parentId: 0, children: [2], childCount: 1 },
    { id: 2, parentId: 1, children: [3], childCount: 1 },
    { id: 3, parentId: 2, childCount: 0 },
    { id: 4, parentId: 0, children: [5], childCount: 1 },
    { id: 5, parentId: 4, childCount: 0 }
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const matches = [{ nodeId: 3 }, { nodeId: 5 }];
  let expandedIds = new Set([0]);
  let activeMatchIndex = 0;
  let scrollTargetId = matches[activeMatchIndex].nodeId;

  expandedIds = revealNode(scrollTargetId, nodesById, expandedIds);
  assert(visibleNodes([0], nodesById, expandedIds).some((node) => node.id === 3), "first match was not revealed");

  activeMatchIndex = 1;
  scrollTargetId = matches[activeMatchIndex].nodeId;
  expandedIds = revealNode(scrollTargetId, nodesById, expandedIds);
  const afterExpand = visibleNodes([0], nodesById, expandedIds);
  assert(afterExpand.some((node) => node.id === 5), "next match was not revealed after expansion");
  assert(afterExpand.findIndex((node) => node.id === scrollTargetId) >= 0, "scroll target is not visible");
});

await check("release zip has manifest at archive root and no stale duplicate hashed assets", async () => {
  const { stdout } = await run("unzip", ["-l", releaseZip]);
  assert(stdout.includes("manifest.json"), "release zip missing root manifest");
  const assetLines = stdout.split("\n").filter((line) => line.includes("assets/") && line.includes(".js"));
  const popupAssets = assetLines.filter((line) => line.includes("popup-"));
  const sidepanelAssets = assetLines.filter((line) => line.includes("sidepanel-"));
  const globalAssets = assetLines.filter((line) => line.includes("global-"));
  const workerAssets = assetLines.filter((line) => line.includes("jsonParser.worker-"));
  assert(popupAssets.length === 1, "unexpected popup asset count", String(popupAssets.length));
  assert(sidepanelAssets.length === 1, "unexpected sidepanel asset count", String(sidepanelAssets.length));
  assert(globalAssets.length === 1, "unexpected global JS asset count", String(globalAssets.length));
  assert(workerAssets.length === 1, "unexpected worker asset count", String(workerAssets.length));
});

await check("split-json-array creates valid smaller JSON arrays", async () => {
  const dir = await mkdtemp(join(tmpdir(), "jsonbolt-split-"));
  const input = join(dir, "input.json");
  await writeFile(input, JSON.stringify([{ a: 1 }, { b: "x" }, { c: [1, 2, 3] }]));
  await run("node", ["scripts/split-json-array.mjs", input, "0.00001", "0.00001"]);
  const first = JSON.parse(await readFile(join(dir, "input-0.00001MB.json"), "utf8"));
  assert(Array.isArray(first) && first.length >= 1, "split output is not a JSON array");
});

try {
  await access(largeFixture);
  await check("100MB fixture target hash is found by worker search", async () => {
    const text = await readFile(largeFixture, "utf8");
    assert(text.includes(targetHash), "fixture does not contain target hash");
    const worker = await createWorkerHarness();
    const parseResponses = await worker.request({ type: "parse", text, requestId: 100 });
    const success = parseResponses.find((item) => item.type === "success");
    assert(success, "100MB parse failed", JSON.stringify(parseResponses.find((item) => item.type === "error")));
    const searchResponses = await worker.request({ type: "search", requestId: 100, query: targetHash, limit: 10 });
    const search = searchResponses.find((item) => item.type === "search");
    assert(search?.matches.length > 0, "100MB target hash was not found by worker search");
  });
} catch {
  skipped.push(`100MB fixture missing: ${largeFixture}`);
}

console.log(JSON.stringify({ passed: checks.length, skipped, checks }, null, 2));
