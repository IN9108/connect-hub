const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const file = path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-pages", "ai-testimonies", "content-pages", "AI-Testimonies.en-US.webpage.custom_javascript.js");
const page = fs.readFileSync(file.replace("custom_javascript.js", "copy.html"), "utf8");
assert(page.indexOf('id="floatingTagsWrapper"') > -1 && page.indexOf('id="floatingTagsWrapper"') < page.indexOf('class="stories-carousel"'));

async function run(items, error) {
  let onReady;
  const calls = [];
  const loading = { textContent: "", removed: false, role: "status", remove() { this.removed = true; }, setAttribute(name, value) { this[name] = value; } };
  const browser = {
    document: {
      addEventListener(event, callback) { assert.equal(event, "DOMContentLoaded"); onReady = callback; },
      getElementById(id) { return id === "storiesLoading" ? loading : null; },
      querySelector() { return null; }
    },
    ConnectHubContent: {
      async list(kind) { calls.push(["list", kind]); if (error) throw error; return items; },
      safeUrl(url) { calls.push(["safeUrl", url]); return url || ""; }
    },
    fetch() { throw new Error("Static testimony JSON must not be requested"); },
    console: { error() {} }
  };
  browser.window = browser;
  vm.runInNewContext(fs.readFileSync(file, "utf8"), browser);
  await onReady();
  return { calls, loading };
}

(async () => {
  const shown = await run([{ title: "Colleague", quote: "Useful story", imageUrl: "/portrait.jpg", paragraphs: ["Saved time"], tags: ["Copilot"] }]);
  assert.deepEqual(shown.calls[0], ["list", "testimony"]);
  assert.deepEqual(shown.calls[1], ["safeUrl", "/portrait.jpg"]);
  assert.equal(shown.loading.removed, true);

  const empty = await run([]);
  assert.deepEqual(empty.calls, [["list", "testimony"]]);
  assert.equal(empty.loading.textContent, "No stories are published yet.");
  assert.equal(empty.loading.removed, false);

  const unavailable = await run([], new Error("ContentHub unavailable"));
  assert.equal(unavailable.loading.role, "alert");
  assert.match(unavailable.loading.textContent, /unavailable right now/i);
  console.log("PASS ConnectHub testimonies use published ContentHub records only");
})().catch((error) => { console.error(error); process.exitCode = 1; });
