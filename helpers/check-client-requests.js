const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const requests = [];
const browser = {
  location: { pathname: "/training" },
  document: {
    documentElement: { dataset: {} },
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return { value: "csrf-token" }; },
  },
  localStorage: { getItem() { return null; } },
  sessionStorage: {},
  matchMedia() { return { matches: true }; },
  addEventListener() {},
  async fetch(url, options) {
    requests.push({ url, options });
    return { ok: true, json: async () => ({ success: true, data: '{"success":true}' }) };
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
  console.log("PASS ConnectHub client requests");
})().catch(error => { console.error(error); process.exitCode = 1; });
