const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const requests = [];
const saved = new Map();
let failPublic = false;
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
    if (url.startsWith("/_api/serverlogics/ContentHub?"))
      return { ok: true, json: async () => failPublic ? { success: false, message: "Unavailable" } : { success: true, data: [] } };
    return { ok: true, json: async () => ({ success: true, data: '{"success":true,"data":{"contactId":"test-contact"}}' }) };
  },
};
browser.window = browser;
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-files", "shared.js"), "utf8"), browser);
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-files", "content.js"), "utf8"), browser);

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
  assert.equal(browser.ConnectHub.cache.has("training:dashboard"), false);
  browser.location.pathname = "/training";
  await browser.TrainingHub.init();
  assert.equal(requests.length, 4, "Training should read current published content on navigation");
  await browser.TrainingHub.init(true);
  assert.equal(requests.length, 5, "Forced refresh must still fetch");
  await browser.TrainingHub.updateState(browser.TrainingHub.STATUS.COMPLETED, "module-id");
  assert.equal(requests.length, 6, "Saving progress must not fetch a full dashboard before navigation");
  assert.equal(requests[5].options.method, "POST");
  await browser.TrainingHub.init();
  assert.equal(requests.length, 7, "The next page must fetch fresh progress after a save");

  const published = await browser.ConnectHubContent.list("prompt");
  assert.deepEqual(Array.from(published), [], "An empty published list must stay empty");
  assert.equal(requests[7].url, "/_api/serverlogics/ContentHub?action=list&kind=prompt");
  assert.equal(requests[7].options.credentials, "same-origin");
  assert.equal(requests[7].options.headers.__RequestVerificationToken, "csrf-token");
  assert.equal(requests[7].options.cache, "no-store", "Published content must be fresh after unpublish");
  await assert.rejects(() => browser.ConnectHubContent.list("media"), /Unsupported list kind/);
  assert.equal(requests.length, 8, "Invalid content kind must not contact the server");
  failPublic = true;
  await assert.rejects(() => browser.ConnectHubContent.list("testimony"));
  assert.equal(requests.length, 9, "Public errors must not fetch legacy static JSON");
  console.log("PASS ConnectHub client requests");
})().catch(error => { console.error(error); process.exitCode = 1; });
