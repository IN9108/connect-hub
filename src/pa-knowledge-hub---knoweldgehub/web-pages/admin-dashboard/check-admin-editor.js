const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "content-pages", "Admin-Dashboard.en-US.webpage.custom_javascript.js"), "utf8");
const nodes = new Map();
const node = (id) => {
  if (!nodes.has(id)) nodes.set(id, {
    id, value: id === "adminNewKind" ? "learningPath" : id === "adminStatusFilter" ? "all" : "",
    dataset: {}, hidden: false, innerHTML: "", textContent: "", listeners: {},
    classList: {toggle() {}}, addEventListener(name, fn) { this.listeners[name] = fn; },
    querySelectorAll() { return []; }, querySelector() { return {focus() {}}; },
    reportValidity() { return true; }, focus() {}, append() {}, showModal() {}
  });
  return nodes.get(id);
};
const root = node("adminHub");
const controls = [{dataset: {}, disabled: false}, {dataset: {}, disabled: true}];
root.querySelectorAll = () => controls;
let lastNoticeButton;
node("adminNotice").append = (_, button) => { lastNoticeButton = button; };
const sent = [];
let item;
let failNextSaveNetwork = false;
let rejectNextSaveConflict = false;
const response = (data) => ({ok: true, status: 200, json: async () => ({success: true, data})});
const fetch = async (url, options) => {
  const action = url.searchParams.get("action");
  const body = options.body && JSON.parse(options.body);
  sent.push({action, body});
  if (action === "listContent") return response({items: item ? [item] : [], learningPaths: [], importNeeded: false});
  if (action === "saveContent") {
    assert.equal(controls[0].disabled, true, "form input must be disabled while saving");
    if (failNextSaveNetwork) { failNextSaveNetwork = false; throw new Error("Connection interrupted"); }
    if (rejectNextSaveConflict) { rejectNextSaveConflict = false; return {ok: false, status: 409, json: async () => ({success: false, message: "Revision conflict"})}; }
    assert.equal(body.kind, "learningPath");
    assert.equal(body.revision, 0);
    assert.equal(body.data.title, "Safety basics");
    assert.match(body.id, /^[\da-f-]{36}$/i);
    assert.match(body.requestId, /^[\da-f-]{36}$/i);
    item = {id: body.id, kind: body.kind, name: body.data.title, draft: body.data, revision: 1, status: "draft", published: false};
    return response({operationId: "save-1", itemId: body.id});
  }
  if (action === "publishContent") {
    assert.equal(body.id, item.id);
    assert.equal(body.revision, 1);
    assert.match(body.requestId, /^[\da-f-]{36}$/i);
    item = {...item, revision: 2, publishedRevision: 2, status: "published", published: true, pageUrl: "/safety-basics/"};
    return response({operationId: "publish-1", itemId: body.id});
  }
  if (action === "unpublishContent") {
    assert.equal(body.id, item.id);
    assert.equal(body.revision, 2);
    assert.match(body.requestId, /^[\da-f-]{36}$/i);
    item = {...item, revision: 3, status: "unpublished", published: false};
    return response({operationId: "unpublish-1", itemId: body.id});
  }
  if (action === "operation") return response({id: url.searchParams.get("id"), status: "succeeded", itemId: item.id, pageUrl: item.pageUrl});
  if (action === "getContent") return response(item);
  throw new Error("Unexpected action " + action);
};
const window = {location: {origin: "https://example.test", pathname: "/admin-dashboard/"}, currentContactId: "contact-1",
  ConnectHubContent: {safeUrl: (value) => /^\/(?!\/)/.test(value) || /^https:\/\//.test(value) ? value : "",
    validate: () => ({valid: true}), render: () => '<a id="completeModule" href="/next">Continue</a><button data-correct="true">Answer</button>'},
  addEventListener() {}};
const document = {readyState: "complete", getElementById: node,
  createElement: () => ({dataset: {}, listeners: {}, classList: {toggle() {}}, addEventListener(name, fn) {this.listeners[name] = fn;}, append() {}})};
const storage = new Map();
const sessionStorage = {getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key)};
vm.runInNewContext(source, {window, document, location: window.location, URL, fetch, crypto: webcrypto,
  ConnectHub: {escapeHtml: (value) => String(value ?? ""), getToken: async () => "token"},
  sessionStorage, confirm: () => true, setTimeout});
const click = (id, dataset = {}) => root.listeners.click({target: {closest: () => ({id, dataset})}});
const tick = () => new Promise((resolve) => setImmediate(resolve));
(async () => {
  await tick();
  await click("adminCreate");
  const title = {dataset: {path: "title"}, value: "Safety basics", type: "text", setCustomValidity() {},
    parentElement: {querySelector: () => null}};
  root.listeners.input({target: title});
  await click("adminSave");
  if (!item) throw new Error(node("adminNotice").textContent || "Save did not reach the API");
  assert.equal(item.revision, 1);
  assert.equal(controls[0].disabled, false, "form input must be enabled after save");
  assert.equal(controls[1].disabled, true, "an originally disabled control stays disabled");
  assert.equal(storage.size, 0, "completed operation must clear contact-scoped recovery state");
  await click("adminPublish");
  if (item.status !== "published") throw new Error(node("adminNotice").textContent || "Publish did not reach the API");
  assert.equal(item.status, "published");
  assert.equal(sent.filter((entry) => entry.action === "operation").length, 2);
  assert.match(node("adminEditorStatus").textContent, /Published|published/);
  await click("adminUnpublish");
  assert.equal(item.status, "unpublished");
  const previewLink = {removed: [], removeAttribute(name) {this.removed.push(name);}};
  const previewButton = {disabled: false};
  node("adminDialogBody").querySelectorAll = (selector) => selector === "[id]" ? [previewLink] :
    selector === "a" ? [previewLink] : selector === "button,input,select,textarea" ? [previewButton] : [];
  await click("adminPreview");
  assert.ok(previewLink.removed.includes("id") && previewLink.removed.includes("href"));
  assert.equal(previewButton.disabled, true);
  item = {id: "module-1", kind: "module", revision: 3, status: "published", published: true,
    draft: {title: "Existing module", templateKey: "module-template", fields: {title: "Existing module"}, slug: "existing-module"},
    template: {html: "<h1>[[field:title]]</h1>", editableFields: [{key: "title", label: "Heading", type: "text"}]}};
  await click("", {open: item.id});
  assert.match(node("adminForm").innerHTML, /data-path="learningPathId"/);
  assert.match(node("adminForm").innerHTML, /data-path="required"/);
  assert.match(node("adminForm").innerHTML, /data-path="fields.title"/);
  assert.match(node("adminForm").innerHTML, /data-path="slug"[^>]*readonly/);
  item = {...item, id: "agent-1", kind: "agent", draft: {...item.draft, title: "Existing agent"}};
  await click("", {open: item.id});
  assert.match(node("adminForm").innerHTML, /data-path="launchUrl"/);
  assert.match(node("adminForm").innerHTML, /data-path="description"/);
  await click("adminDuplicate");
  assert.match(node("adminForm").innerHTML, /data-path="slug"[^>]*value=""[^>]*>/);
  assert.doesNotMatch(node("adminForm").innerHTML, /data-path="slug"[^>]*readonly/);
  await click("adminCreate");
  root.listeners.input({target: title});
  failNextSaveNetwork = true;
  await click("adminSave");
  assert.equal(node("adminForm").inert, true, "ambiguous request must freeze draft controls");
  const firstAmbiguous = sent.filter((entry) => entry.action === "saveContent").at(-1).body;
  const count = sent.length;
  await click("adminSave");
  assert.equal(sent.length, count, "new operation must be blocked while ambiguous request awaits retry");
  assert.equal(lastNoticeButton.textContent, "Retry request");
  await lastNoticeButton.listeners.click();
  assert.equal(node("adminForm").inert, false, "resolved request must unlock draft controls");
  const retried = sent.filter((entry) => entry.action === "saveContent").at(-1).body;
  assert.equal(retried.requestId, firstAmbiguous.requestId, "retry must reuse request ID");
  await click("adminCreate");
  root.listeners.input({target: title});
  rejectNextSaveConflict = true;
  await click("adminSave");
  assert.equal(lastNoticeButton.textContent, "Reload latest", "deterministic conflict should offer reload, not retry");
  await click("adminCreate");
  root.listeners.input({target: title});
  failNextSaveNetwork = true;
  await click("adminSave");
  rejectNextSaveConflict = true;
  await lastNoticeButton.listeners.click();
  assert.equal(lastNoticeButton.textContent, "Reload latest", "retry that reveals conflict should offer reload");
  assert.equal(node("adminForm").inert, false);
  console.log("Admin editor operations, retry handling, imported fields, and preview safety passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
