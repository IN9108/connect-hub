const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

let onReady;
let stories;
const browser = {
  document: {
    addEventListener(_event, callback) { onReady = callback; },
    getElementById() { return null; },
    querySelector() { return null; },
  },
  ConnectHub: { cache: { async get(_key, load) { stories = await load(); return stories; } } },
  TrainingHub: { async _callServer() { return { data: [
    { crd38_name: "test", crd38_quote: "test" },
    { crd38_name: "New colleague", crd38_quote: "Useful story" },
  ] }; } },
  async fetch() { return { ok: true, async json() { return [{ name: "Published colleague", quote: "Published story" }]; } }; },
  console,
};
const file = path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-pages", "ai-testimonies", "content-pages", "AI-Testimonies.en-US.webpage.custom_javascript.js");
vm.runInNewContext(fs.readFileSync(file, "utf8"), browser);
onReady().then(() => {
  assert.equal(stories.length, 2);
  assert.deepEqual(Array.from(stories, (item) => item.name), ["Published colleague", "New colleague"]);
  console.log("PASS ConnectHub testimonies");
}).catch((error) => { console.error(error); process.exitCode = 1; });
