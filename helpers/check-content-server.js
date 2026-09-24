const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const site = path.join(root, "src/pa-knowledge-hub---knoweldgehub");
execFileSync(process.execPath, [path.join(__dirname, "build-content-server.js")], { cwd: root, stdio: "pipe" });
const adminScript = fs.readFileSync(path.join(site, "server-logic/AdminHubMaster.js"), "utf8");
const publicScript = fs.readFileSync(path.join(site, "server-logic/ContentHub.js"), "utf8");
const adminMetadata = fs.readFileSync(path.join(site, "server-logic/AdminHubMaster.serverlogic.yml"), "utf8");
const publicMetadata = fs.readFileSync(path.join(site, "server-logic/ContentHub.serverlogic.yml"), "utf8");
const CONTACT = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PATH = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const BUSINESS_MODULE = "cccccccc-cccc-cccc-cccc-cccccccccccc";
let sequence = 0;
const guid = () => `11111111-1111-4111-8111-${String(++sequence).padStart(12, "0")}`;
const envelope = (body) => JSON.stringify({ IsSuccessStatusCode: true, StatusCode: 200, Body: JSON.stringify(body) });

function harness() {
  const tables = new Map();
  const calls = [];
  const rows = (table) => {
    if (!tables.has(table)) tables.set(table, new Map());
    return tables.get(table);
  };
  const idField = (table) => ({
    crd38_contentitems: "crd38_contentitemid", crd38_contentoperations: "crd38_contentoperationid",
    crd38_publishedcontents: "crd38_publishedcontentid",
    crd38_learningpaths: "crd38_learningpathid", crd38_trainingmodules: "crd38_trainingmoduleid",
    crd38_aitestimonies: "crd38_aitestimonyid"
  })[table];
  function put(table, row) {
    const id = row[idField(table)];
    assert(id, `Missing ${table} primary key`);
    rows(table).set(id, structuredClone(row));
  }
  const server = {
    User: { contactid: CONTACT }, Context: { QueryParameters: {}, Body: "" }, Logger: { Error() {} },
    Connector: { Dataverse: {
      RetrieveMultipleRecords(table, query) {
        calls.push(["read", table, query]);
        const params = new URLSearchParams(query);
        const filter = params.get("$filter") || "";
        let found = [...rows(table).values()];
        const match = (name, value) => found = found.filter((row) => String(row[name] ?? "").toLowerCase() === String(value).toLowerCase());
        for (const [, name, raw] of filter.matchAll(/(crd38_\w+|statecode)\s+eq\s+('[^']*'|[\w-]+)/g)) match(name, raw.startsWith("'") ? raw.slice(1, -1) : raw);
        const skip = Number(params.get("$skip") || 0);
        const page = found.slice(skip, skip + 5);
        const next = skip + 5 < found.length ? `https://example.invalid/${table}?${query.replace(/(?:^|&)\$skip=\d+/, "")}&$skip=${skip + 5}` : undefined;
        return envelope({ value: page, ...(next ? { "@odata.nextLink": next } : {}) });
      },
      CreateRecord(table, payload) {
        const row = JSON.parse(payload);
        calls.push(["create", table, row]);
        const id = row[idField(table)];
        if (rows(table).has(id)) return JSON.stringify({ IsSuccessStatusCode: false, StatusCode: 409, Body: "{}" });
        put(table, row);
        return envelope(row);
      }
    } }
  };
  const admin = vm.createContext({ Server: server });
  const publicApi = vm.createContext({ Server: server });
  vm.runInContext(adminScript, admin);
  vm.runInContext(publicScript, publicApi);
  const seed = vm.runInContext("CONTENT_SEED", admin);
  const marker = vm.runInContext("MARKER", admin);
  function request(context, method, action, body, query = {}) {
    server.Context.QueryParameters = { action, ...query };
    server.Context.Body = JSON.stringify(body ?? {});
    return JSON.parse(context[method]());
  }
  const post = (action, body) => request(admin, "post", action, body);
  const get = (action, query) => request(admin, "get", action, {}, query);
  const list = (kind) => request(publicApi, "get", "list", {}, { kind });
  return { server, tables, calls, put, rows, seed, marker, post, get, list };
}

function savedRow(h, operationId) {
  const op = h.rows("crd38_contentoperations").get(operationId);
  assert(op, "Save should queue an operation");
  const payload = JSON.parse(op.crd38_payloadjson);
  h.put("crd38_contentitems", {
    crd38_contentitemid: payload.itemId, crd38_kind: payload.kind, crd38_name: payload.title,
    crd38_draftjson: payload.draftJson, crd38_publishedjson: "", crd38_revision: payload.revision,
    crd38_publishedrevision: 0, crd38_status: "unpublished", crd38_pageurl: payload.pageUrl,
    crd38_templatejson: payload.templateJson, crd38_businessid: payload.businessId,
    crd38_pageid: payload.pageId, crd38_contentpageid: payload.contentPageId
  });
  op.crd38_status = "succeeded";
  return payload;
}

const failures = [];
function check(name, fn) {
  try { fn(); console.log("PASS", name); }
  catch (error) { failures.push(name); console.error("FAIL", name, error.message); }
}

check("server roles and private operation table", () => {
  const roles = (text) => [...text.matchAll(/^- ([0-9a-f-]{36})$/gmi)].map((match) => match[1]);
  assert.equal(roles(adminMetadata).length, 1, "Admin endpoint needs one Administrator role");
  assert(roles(publicMetadata).includes(roles(adminMetadata)[0]), "Public endpoint should include administrators");
  assert(roles(publicMetadata).length > 1, "Public endpoint needs its signed-in member role");
  const settings = fs.readFileSync(path.join(site, "sitesetting.yml"), "utf8");
  assert(!/Webapi\/crd38_contentoperations\//i.test(settings), "Operation table must not have public Web API settings");
  const permissions = path.join(site, "table-permissions");
  const itemPermission = fs.readFileSync(path.join(permissions, "Content-Items-Admin.tablepermission.yml"), "utf8");
  const operationPermission = fs.readFileSync(path.join(permissions, "Content-Operations-Admin.tablepermission.yml"), "utf8");
  const publishedPermission = fs.readFileSync(path.join(permissions, "Published-Content-Read.tablepermission.yml"), "utf8");
  const adminRole = roles(adminMetadata)[0];
  const memberRole = roles(publicMetadata).find((role) => role !== adminRole);
  assert(itemPermission.includes(adminRole) && !itemPermission.includes(memberRole));
  assert(operationPermission.includes(adminRole) && !operationPermission.includes(memberRole));
  assert(publishedPermission.includes(memberRole) && !publishedPermission.includes(adminRole));
  assert.match(publishedPermission, /adx_read: true/);
  assert.match(publishedPermission, /adx_write: false/);
});

check("authentication and action allowlists", () => {
  const h = harness();
  h.server.User.contactid = "";
  assert.equal(h.post("importContent", {}).success, false);
  assert.equal(h.get("listContent").success, false);
  assert.equal(h.list("prompt").success, false);
  h.server.User.contactid = CONTACT;
  assert.equal(h.post("deleteAll", {}).success, false);
  assert.equal(h.get("deleteAll").success, false);
  assert.equal(h.list("media").success, false);
});

check("public migration fallback ends permanently at import marker", () => {
  const h = harness();
  const before = h.list("prompt");
  assert.equal(before.success, true);
  assert(before.data.length > 0, "Initial migration should show packaged prompts");
  assert(h.calls.every(([, table]) => table !== "crd38_contentitems" && table !== "crd38_contentoperations"), "Public reads must stay off admin tables");
  h.put("crd38_publishedcontents", { crd38_publishedcontentid: h.marker });
  assert.deepEqual(h.list("prompt").data, [], "Unpublished seed content must never reappear");
  const published = h.seed.records.find((item) => item.kind === "prompt");
  h.put("crd38_contentitems", { crd38_contentitemid: published.itemId, crd38_kind: "prompt", crd38_status: "published",
    crd38_draftjson: JSON.stringify({ title: "Private draft", prompt: "secret" }) });
  h.put("crd38_publishedcontents", { crd38_publishedcontentid: published.itemId, crd38_kind: "prompt", crd38_status: "published",
    crd38_publishedjson: JSON.stringify({ title: "Public", prompt: "published" }), crd38_pageurl: "/prompt-library" });
  const priorCalls = h.calls.length;
  const result = h.list("prompt");
  assert.equal(result.data.length, 1);
  assert.equal(result.data[0].title, "Public");
  assert(!JSON.stringify(result).includes("Private draft"));
  assert(h.calls.slice(priorCalls).every(([, table]) => table === "crd38_publishedcontents"), "Public list must only read the published snapshot");
  assert(h.calls.findLast(([type, table, query]) => type === "read" && table === "crd38_publishedcontents" && query.includes("crd38_status"))[2].includes("$select=crd38_publishedcontentid,crd38_publishedjson,crd38_pageurl"));
});

check("import is paged, preserves edits, and maps existing business IDs", () => {
  const h = harness();
  const moduleSeed = h.seed.records.find((item) => item.kind === "module");
  h.put("crd38_learningpaths", { crd38_learningpathid: PATH, crd38_name: "Original path", statecode: 0 });
  h.put("crd38_trainingmodules", { crd38_trainingmoduleid: BUSINESS_MODULE, crd38_name: "Original module", crd38_pageurl: moduleSeed.pageUrl,
    _crd38_learningpathref_value: PATH, statecode: 0, crd38_displayorder: 4 });
  const first = h.post("importContent", {});
  assert.equal(first.success, true, first.message);
  assert.equal(h.rows("crd38_contentitems").get(moduleSeed.itemId).crd38_businessid, BUSINESS_MODULE);
  assert(h.rows("crd38_contentitems").has(PATH));
  assert(h.rows("crd38_contentitems").has(h.marker));
  assert(h.rows("crd38_publishedcontents").has(h.marker));
  const moduleSnapshot = h.rows("crd38_publishedcontents").get(moduleSeed.itemId);
  assert(moduleSnapshot);
  assert(!Object.hasOwn(moduleSnapshot, "crd38_draftjson") && !Object.hasOwn(moduleSnapshot, "crd38_templatejson"));
  const home = h.seed.records.find((item) => item.pageUrl === "/");
  h.rows("crd38_contentitems").get(home.itemId).crd38_draftjson = JSON.stringify({ title: "Manager edit" });
  const again = h.post("importContent", {});
  assert.equal(again.success, true);
  assert.equal(again.data.imported, 0);
  assert.equal(JSON.parse(h.rows("crd38_contentitems").get(home.itemId).crd38_draftjson).title, "Manager edit");
  assert.equal(h.get("listContent").success, true);
  assert(h.calls.filter(([type, table]) => type === "read" && table === "crd38_contentitems").some(([, , query]) => query.includes("$skip=")), "Import should follow Dataverse next links");
  h.rows("crd38_publishedcontents").delete(home.itemId);
  h.rows("crd38_publishedcontents").delete(h.marker);
  const resumed = h.post("importContent", {});
  assert.equal(resumed.success, true);
  assert.equal(resumed.data.imported, 0);
  assert(h.rows("crd38_publishedcontents").has(home.itemId));
  assert(h.rows("crd38_publishedcontents").has(h.marker));
  assert.equal(JSON.parse(h.rows("crd38_contentitems").get(home.itemId).crd38_draftjson).title, "Manager edit");
});

check("failed import never writes completion marker", () => {
  const h = harness();
  h.put("crd38_trainingmodules", { crd38_trainingmoduleid: BUSINESS_MODULE, crd38_name: "Unknown published module", crd38_pageurl: "/training/missing", statecode: 0 });
  const result = h.post("importContent", {});
  assert.equal(result.success, false);
  assert(!h.rows("crd38_contentitems").has(h.marker));
  assert(!h.rows("crd38_publishedcontents").has(h.marker));
});

check("Dataverse read errors fail closed instead of showing seed data", () => {
  const h = harness();
  h.server.Connector.Dataverse.RetrieveMultipleRecords = () => JSON.stringify({ IsSuccessStatusCode: false, StatusCode: 503, Body: "{}" });
  assert.equal(h.list("prompt").success, false);
  assert.equal(h.post("importContent", {}).success, false);
  assert(!h.rows("crd38_contentitems").has(h.marker));
  assert(!h.rows("crd38_publishedcontents").has(h.marker));
});

check("revision conflict and request ID retry are safe", () => {
  const h = harness();
  const id = guid(), requestId = guid();
  const data = { title: "New agent", description: "Helps colleagues", slug: "new-agent", launchUrl: "https://example.com/agent" };
  const first = h.post("saveContent", { id, requestId, revision: 0, kind: "agent", data });
  assert.equal(first.success, true, first.message);
  savedRow(h, first.data.operationId);
  assert.equal(h.post("saveContent", { id, requestId: guid(), revision: 0, kind: "agent", data }).success, false, "Stale revision must fail");
  const retry = h.post("saveContent", { id, requestId, revision: 0, kind: "agent", data });
  assert.equal(retry.success, true, "Identical retry must return its saved operation after success");
  assert.equal(retry.data.operationId, requestId);
  assert.equal(h.post("saveContent", { id, requestId, revision: 0, kind: "agent", data: { ...data, title: "Different" } }).success, false,
    "Request ID must be bound to the original payload");
});

check("new page publication queues metadata, trusted HTML, and business mapping", () => {
  const h = harness();
  h.put("crd38_learningpaths", { crd38_learningpathid: PATH, crd38_name: "Path", statecode: 0 });
  for (const kind of ["module", "agent"]) {
    const id = guid(), requestId = guid();
    const slug = `new-${kind}`;
    const data = { title: "<Safe>{{7*7}}", description: "Useful", slug,
      learningPathId: kind === "module" ? PATH : "", launchUrl: kind === "agent" ? "https://example.com/agent" : "",
      sections: [{ type: "text", title: "Start", body: "<script>alert(1)</script>" }] };
    const save = h.post("saveContent", { id, requestId, revision: 0, kind, data });
    assert.equal(save.success, true, save.message);
    const saved = savedRow(h, save.data.operationId);
    const expectedUrl = kind === "module" ? `/training/${slug}` : `/agents/${slug}`;
    assert.equal(saved.pageUrl, expectedUrl);
    assert.match(saved.pageId, /^[0-9a-f-]{36}$/);
    assert.match(saved.contentPageId, /^[0-9a-f-]{36}$/);
    const published = h.post("publishContent", { id, requestId: guid(), revision: 1 });
    assert.equal(published.success, true, published.message);
    const op = h.rows("crd38_contentoperations").get(published.data.operationId);
    const payload = JSON.parse(op.crd38_payloadjson);
    assert.equal(payload.pageUrl, expectedUrl);
    assert.equal(payload.parentPageId, kind === "module" ? "b952d107-de4d-494f-1842-7d475cf9064d" : "7d84914c-0e48-8164-d81c-76302ea8898c");
    assert.equal(payload.pageTemplateId, "a58b3fad-c6c6-4b81-a13d-be720b88a783");
    assert(payload.html.includes("&lt;script&gt;") && !payload.html.includes("<script>"));
    assert(payload.html.includes("&#123;&#123;7*7&#125;&#125;"));
    if (kind === "module") assert.equal(payload.businessPayload["crd38_LearningPathRef@odata.bind"], `/crd38_learningpaths(${PATH})`);
  }
});

check("linked agent keeps its existing training module business row", () => {
  const h = harness();
  const agent = h.seed.records.find((item) => item.kind === "agent");
  h.put("crd38_learningpaths", { crd38_learningpathid: PATH, crd38_name: "Path", statecode: 0 });
  h.put("crd38_trainingmodules", { crd38_trainingmoduleid: BUSINESS_MODULE, crd38_name: agent.title,
    crd38_pageurl: agent.pageUrl, _crd38_learningpathref_value: PATH, statecode: 0 });
  assert.equal(h.post("importContent", {}).success, true);
  const item = h.rows("crd38_contentitems").get(agent.itemId);
  assert.equal(item.crd38_businessid, BUSINESS_MODULE);
  const published = h.post("publishContent", { id: agent.itemId, requestId: guid(), revision: 1 });
  assert.equal(published.success, true, published.message);
  const payload = JSON.parse(h.rows("crd38_contentoperations").get(published.data.operationId).crd38_payloadjson);
  assert.equal(payload.kind, "agent");
  assert.equal(payload.businessId, BUSINESS_MODULE);
  assert.equal(payload.businessTable, "crd38_trainingmodules");
  assert.equal(payload.businessPayload.crd38_pageurl, agent.pageUrl);
  assert.equal(payload.businessPayload["crd38_LearningPathRef@odata.bind"], `/crd38_learningpaths(${PATH})`);
});

check("imported page fields cannot inject HTML, Liquid, or a new template", () => {
  const h = harness();
  assert.equal(h.post("importContent", {}).success, true);
  const home = h.seed.records.find((item) => item.pageUrl === "/");
  const row = h.rows("crd38_contentitems").get(home.itemId);
  const draft = JSON.parse(row.crd38_draftjson);
  const slot = "title" in draft.fields ? "title" : Object.keys(draft.fields)[0];
  draft.fields[slot] = '<img src=x onerror=alert(1)>{{7*7}}';
  const bad = h.post("saveContent", { id: home.itemId, requestId: guid(), revision: 1, kind: row.crd38_kind,
    data: { ...draft, templateKey: "other-template" } });
  assert.equal(bad.success, false);
  const good = h.post("saveContent", { id: home.itemId, requestId: guid(), revision: 1, kind: row.crd38_kind, data: draft });
  assert.equal(good.success, true, good.message);
  const operation = h.rows("crd38_contentoperations").get(good.data.operationId);
  const payload = JSON.parse(operation.crd38_payloadjson);
  row.crd38_draftjson = payload.draftJson;
  row.crd38_revision = 2;
  const published = h.post("publishContent", { id: home.itemId, requestId: guid(), revision: 2 });
  assert.equal(published.success, true, published.message);
  const html = JSON.parse(h.rows("crd38_contentoperations").get(published.data.operationId).crd38_payloadjson).html;
  assert(html.includes("&lt;img src=x onerror=alert(1)&gt;&#123;&#123;7*7&#125;&#125;"));
  assert(!html.includes('<img src=x onerror=alert(1)>'));
});

check("media upload queues a real Web File request with stable page metadata", () => {
  const h = harness();
  const id = guid();
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lWQAAAAASUVORK5CYII=";
  const result = h.post("uploadMedia", { requestId: id, contentType: "image/png", name: "Portrait", alt: "Colleague portrait", base64: png });
  assert.equal(result.success, true, result.message);
  const payload = JSON.parse(h.rows("crd38_contentoperations").get(id).crd38_payloadjson);
  assert.equal(payload.kind, "media");
  assert.equal(payload.filename, `ch-${id}.png`);
  assert.equal(payload.pageUrl, `/${payload.filename}`);
  assert.match(payload.mediaId, /^[0-9a-f-]{36}$/);
  assert.equal(payload.parentPageId, h.seed.homePageId);
  assert.equal(payload.createIfMissing, true);
  assert.equal(h.post("uploadMedia", { requestId: guid(), contentType: "image/svg+xml", base64: png }).success, false);
});

check("publisher stages the actual Web File and records failed phases", () => {
  const flow = JSON.parse(fs.readFileSync(path.join(root, "power-platform/flows/ContentPublisher.flow.json"), "utf8"));
  const actions = flow.properties.definition.actions;
  const failure = actions.Failure_status;
  assert(failure.runAfter.Process.includes("Failed") && failure.runAfter.Process.includes("TimedOut"));
  assert.equal(failure.actions.If_still_running.actions.Mark_failed.inputs.parameters["item/crd38_status"], "failed");
  const media = actions.Process.actions.If_media.actions;
  assert.equal(media.Media_upload_file.inputs.parameters.entityName, "powerpagecomponents");
  assert.equal(media.Media_upload_file.inputs.parameters.fileImageFieldName, "filecontent");
  assert.deepEqual(media.Media_lookup_public.runAfter, { Media_upload_file: ["Succeeded"] });
  assert.deepEqual(media.Media_commit.runAfter, { Media_stage_public: ["Succeeded"] });
  assert.deepEqual(Object.keys(media.Media_commit.actions),
    ["Media_publish_file", "Media_publish_item", "Media_publish_public", "Media_complete"],
    "Media publish must commit file, item, public snapshot, and success together");
  const save = actions.Process.actions.If_save.actions;
  assert.deepEqual(save.Save_new_or_existing.runAfter, { Save_check_route: ["Succeeded"] });
  assert.match(save.Save_check_route.actions.Save_lookup_route.inputs.parameters.$filter,
    /crd38_pageurl eq .*crd38_contentitemid ne /, "Serialized save must reject a conflicting page address");
  assert.equal(save.Save_check_route.actions.Save_route_available.else.actions.Save_route_conflict_mark_failed.inputs.parameters["item/crd38_status"], "failed");
  const saveChoice = save.Save_new_or_existing;
  for (const commit of [saveChoice.actions.Save_new_transaction, saveChoice.else.actions.Save_existing_transaction]) {
    const committed = Object.values(commit.actions);
    assert.equal(commit.type, "Changeset");
    assert.equal(committed.length, 2);
    assert(committed.some((a) => a.inputs.parameters.entityName === "crd38_contentitems"));
    assert(committed.some((a) => a.inputs.parameters.entityName === "crd38_contentoperations" && a.inputs.parameters["item/crd38_status"] === "succeeded"));
  }
  const page = actions.Process.actions.If_page_publish.actions;
  assert.deepEqual(page.Page_publish_stage_localized.runAfter, { Page_publish_stage_root: ["Succeeded"] });
  const pageBusiness = page.Page_publish_has_business.actions.Page_publishb_new_or_existing;
  const pageCommits = [pageBusiness.actions.Page_publishb_commit_new, pageBusiness.else.actions.Page_publishb_commit_existing,
    page.Page_publish_has_business.else.actions.Page_publish_commit_plain];
  for (const commit of pageCommits) {
    const tables = Object.values(commit.actions).map((a) => a.inputs.parameters.entityName);
    assert.equal(commit.type, "Changeset");
    for (const table of ["powerpagecomponents", "crd38_contentitems", "crd38_publishedcontents", "crd38_contentoperations"])
      assert(tables.includes(table), `Page publish commit must include ${table}`);
    assert.equal(tables.filter((table) => table === "powerpagecomponents").length, 2);
  }
  const unpublish = actions.Process.actions.If_page_unpublish.actions;
  const missingPage = unpublish.Page_unpublish_pages_exist.else.actions;
  assert.equal(missingPage.Page_unpublish_missing_pages_mark_failed.inputs.parameters["item/crd38_status"], "failed");
  assert.equal(missingPage.Page_unpublish_missing_pages_stop.inputs.runStatus, "Failed");
  const unpublishCommits = [unpublish.Page_unpublish_has_business.actions.Page_unpublishb_commit,
    unpublish.Page_unpublish_has_business.else.actions.Page_unpublish_commit_plain];
  for (const commit of unpublishCommits) {
    const entries = Object.values(commit.actions);
    assert.equal(commit.type, "Changeset");
    for (const table of ["powerpagecomponents", "crd38_contentitems", "crd38_publishedcontents", "crd38_contentoperations"])
      assert(entries.some((a) => a.inputs.parameters.entityName === table), `Page unpublish commit must include ${table}`);
    const pageUpdates = entries.filter((a) => a.inputs.parameters.entityName === "powerpagecomponents");
    assert.equal(pageUpdates.length, 2);
    assert(pageUpdates.every((a) => String(a.inputs.parameters["item/content"]).includes("Page_unpublish_get_")),
      "Unpublish must preserve existing page metadata while changing publishing state");
  }
});

if (failures.length) {
  console.error(`${failures.length} content server check(s) failed: ${failures.join(", ")}`);
  process.exitCode = 1;
} else console.log("Content server contract verified.");
