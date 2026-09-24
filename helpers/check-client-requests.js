const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const requests = [];
const saved = new Map();
const browser = {
  location: { pathname: "/" },
  currentContactId: "test-contact",
  document: {
    documentElement: { dataset: {} },
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return { value: "csrf-token" }; },
  },
  localStorage: { getItem() { return null; } },
  sessionStorage: {
    getItem(key) { return saved.get(key) || null; },
    setItem(key, value) { saved.set(key, value); this[key] = value; },
    removeItem(key) { saved.delete(key); delete this[key]; },
  },
  matchMedia() { return { matches: true }; },
  addEventListener() {},
  async fetch(url, options) {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true, data: '{"success":true,"data":{"contactId":"test-contact"}}' }) };
  },
};
browser.window = browser;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-files", "shared.js"), "utf8"), browser);

(async () => {
  assert.equal(browser.document.documentElement.dataset.theme, "light");
  await browser.TrainingHub._callServer("init");
  await browser.TrainingHub._callServer("updateState", "&status=189370002");
  assert.equal(requests[0].options.method, "GET");
  assert.equal(requests[1].options.method, "POST");
  assert.equal(requests[1].options.headers["Content-Type"], "application/json");
  assert.equal(requests[1].options.headers.__RequestVerificationToken, "csrf-token");
  assert.equal(requests[1].options.body, "{}");
  await browser.TrainingHub.init();
  assert.equal(requests[2].url, "/_api/serverlogics/TrainingHubMaster?action=init&currentPath=%2F");
  assert.equal(browser.ConnectHub.cache.has("training:dashboard"), true);
  browser.location.pathname = "/training";
  await browser.TrainingHub.init();
  assert.equal(requests.length, 3, "Training must reuse the Home dashboard cache");
  await browser.TrainingHub.init(true);
  assert.equal(requests.length, 4, "Forced refresh must still fetch");
  await browser.TrainingHub.updateState(browser.TrainingHub.STATUS.COMPLETED, "module-id");
  assert.equal(requests.length, 5, "Saving progress must not fetch a full dashboard before navigation");
  assert.equal(requests[4].options.method, "POST");
  await browser.TrainingHub.init();
  assert.equal(requests.length, 6, "The next page must fetch fresh progress after a save");
  console.log("PASS ConnectHub client requests");
})().catch(error => { console.error(error); process.exitCode = 1; });
