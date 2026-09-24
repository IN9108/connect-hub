// Compiled with the shared content model and the trusted import manifest.
// Entry point access is restricted to Administrators by its serverlogic record.
const ITEMS = "crd38_contentitems";
const OPS = "crd38_contentoperations";
const PUBLIC = "crd38_publishedcontents";
const MARKER = "66d49808-7090-5a75-95ca-353020f9f169";
const SITE = {
  id: "4fcf5d22-8c56-43be-817c-8068dd99cfe3",
  training: "b952d107-de4d-494f-1842-7d475cf9064d",
  agents: "7d84914c-0e48-8164-d81c-76302ea8898c",
  template: "a58b3fad-c6c6-4b81-a13d-be720b88a783"
};
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = ["learningPath", "module", "prompt", "testimony", "agent", "page", "media"];

function object(value) {
  return typeof value === "string" ? JSON.parse(value) : value;
}
function response(raw) {
  const envelope = object(raw);
  if (!envelope || envelope.IsSuccessStatusCode === false || envelope.ServerError || Number(envelope.StatusCode) >= 400)
    throw new Error("Dataverse could not complete this request. Please retry.");
  return envelope.Body ? object(envelope.Body) : {};
}
function records(table, options) {
  let query = options || "";
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const result = response(Server.Connector.Dataverse.RetrieveMultipleRecords(table, query, true));
    if (!Array.isArray(result.value)) throw new Error("Dataverse returned an invalid record list.");
    rows.push(...result.value);
    if (!result["@odata.nextLink"]) return rows;
    const next = result["@odata.nextLink"];
    if (typeof next !== "string" || !next.includes("?")) throw new Error("Invalid Dataverse paging link.");
    query = next.slice(next.indexOf("?") + 1);
  }
  throw new Error("This content list is too large to load safely.");
}
function find(table, id, columns) {
  validId(id);
  const key = table === ITEMS ? "crd38_contentitemid" : table === PUBLIC ? "crd38_publishedcontentid" : "crd38_contentoperationid";
  return records(table, "$filter=" + key + " eq " + id + "&$top=1" + (columns ? "&$select=" + columns : ""))[0] || null;
}
function create(table, value) { return response(Server.Connector.Dataverse.CreateRecord(table, JSON.stringify(value))); }
function validId(value) {
  if (!GUID.test(String(value || ""))) throw new Error("A valid record identifier is required.");
  return String(value).toLowerCase();
}
function json(value, fallback) { return value ? JSON.parse(value) : fallback; }
function relatedId(id, prefix) { return ((parseInt(id.slice(0, 8), 16) ^ parseInt(prefix, 16)) >>> 0).toString(16).padStart(8, "0") + id.slice(8); }
function revision(value) {
  if (!Number.isInteger(value) || value < 0 || value > 2147483646) throw new Error("Reload the content before saving.");
  return value;
}
function normPath(value) { return String(value || "").toLowerCase().replace(/\/$/, "") || "/"; }
function itemView(row, includeTemplate) {
  return {
    id: row.crd38_contentitemid, kind: row.crd38_kind, name: row.crd38_name,
    draft: json(row.crd38_draftjson, {}), published: json(row.crd38_publishedjson, null),
    status: row.crd38_status, revision: row.crd38_revision || 0,
    publishedRevision: row.crd38_publishedrevision || 0, pageUrl: row.crd38_pageurl || "",
    ...(includeTemplate ? { template: json(row.crd38_templatejson, null) } : {})
  };
}
function operationView(row) {
  return { id: row.crd38_contentoperationid, status: row.crd38_status,
    itemId: row.crd38_itemid, pageUrl: row.crd38_pageurl || "",
    message: row.crd38_error || (row.crd38_status === "succeeded" ? "Saved successfully." : "Your request is being processed.") };
}
function seedTemplate(data) {
  return data.templateKey ? CONTENT_SEED.templates[data.templateKey] : null;
}
function checkDraft(input, kind, existing) {
  if (!KINDS.includes(kind) || kind === "media") throw new Error("Choose a supported content type.");
  const data = ConnectHubContent.normalize(input, kind);
  if (data.title.length > 200 || data.description.length > 10000 || data.sections.length > 50 || data.tags.length > 40)
    throw new Error("The title, description or number of sections exceeds its limit.");
  if (!Number.isInteger(data.displayOrder) || data.displayOrder < 0 || data.displayOrder > 100000)
    throw new Error("Display order must be a whole number from 0 to 100000.");
  if (JSON.stringify(data).length > 240000) throw new Error("This content is too large. Split it into separate modules.");
  const trusted = existing ? json(existing.crd38_templatejson, null) : seedTemplate(data);
  if (data.templateKey) {
    if (!trusted || !Array.isArray(trusted.editableFields)) throw new Error("The page template is unavailable. Reload the page.");
    if (existing && data.templateKey !== json(existing.crd38_draftjson, {}).templateKey) throw new Error("An existing page's template cannot be changed.");
    const fields = {};
    for (const field of trusted.editableFields) {
      const value = data.fields[field.key];
      if (typeof value !== "string" || value.length > 20000) throw new Error("Complete the page's editable fields.");
      if (field.type === "url" && value && !ConnectHubContent.safeUrl(value)) throw new Error("Page links must use an approved web address.");
      fields[field.key] = value;
    }
    if (Object.prototype.hasOwnProperty.call(fields, "title")) fields.title = data.title;
    const source = CONTENT_SEED.records.find(row => row.templateKey === data.templateKey);
    if (kind === "agent" && source?.launchUrl) {
      for (const field of trusted.editableFields)
        if (field.type === "url" && source.fields[field.key] === source.launchUrl) fields[field.key] = data.launchUrl;
    }
    data.fields = fields;
  } else {
    if (existing && json(existing.crd38_draftjson, {}).templateKey) throw new Error("The existing page template is required.");
    data.fields = {};
  }
  if (!data.title) throw new Error("Enter a title before saving.");
  for (const key of ["imageUrl", "launchUrl"]) if (data[key] && !ConnectHubContent.safeUrl(data[key])) throw new Error("Use an HTTPS or local web address.");
  if (["module", "agent", "page"].includes(kind)) {
    if (!data.slug && !existing) data.slug = data.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
    if (!existing && !/^[a-z0-9][a-z0-9-]{0,79}$/.test(data.slug)) throw new Error("Use a page address containing letters, numbers and hyphens.");
    if (existing) data.slug = json(existing.crd38_draftjson, {}).slug;
  }
  if (kind === "module" && data.learningPathId) validId(data.learningPathId);
  return { data, template: trusted };
}
function current(id, expected) {
  const item = find(ITEMS, id);
  if (!item || !KINDS.includes(item.crd38_kind)) throw new Error("This content could not be found.");
  if (item.crd38_revision !== revision(expected)) throw new Error("Someone has changed this content. Reload it before saving.");
  return item;
}
function queue(request, action, payload) {
  const requestId = validId(request.requestId);
  const existing = find(OPS, requestId);
  if (existing) {
    if (existing.crd38_itemid !== payload.itemId || existing.crd38_action !== action || existing.crd38_requestedby !== Server.User.contactid)
      throw new Error("This request identifier is already in use. Reload and retry.");
    return { operationId: requestId, itemId: payload.itemId };
  }
  payload.action = action;
  payload.requestJson = JSON.stringify({ ...request, base64: undefined });
  if (JSON.stringify(payload).length > 1000000) throw new Error("The publishing request is too large.");
  create(OPS, { crd38_contentoperationid: requestId, crd38_name: requestId,
    crd38_itemid: payload.itemId, crd38_kind: payload.kind, crd38_action: action,
    crd38_revision: payload.revision, crd38_requestedby: Server.User.contactid,
    crd38_payloadjson: JSON.stringify(payload), crd38_status: "queued", crd38_pageurl: payload.pageUrl || "" });
  return { operationId: requestId, itemId: payload.itemId };
}
function save(request) {
  const id = validId(request.id);
  const old = find(ITEMS, id);
  const expected = revision(request.revision);
  if (old && old.crd38_revision !== expected) throw new Error("Someone has changed this content. Reload it before saving.");
  if (!old && expected !== 0) throw new Error("This content no longer exists. Reload the list.");
  if (old && old.crd38_kind !== request.kind) throw new Error("The content type cannot be changed.");
  const checked = checkDraft(request.data, request.kind, old);
  const data = checked.data;
  let pageUrl = old?.crd38_pageurl || "";
  if (!old && ["module", "agent", "page"].includes(request.kind)) {
    pageUrl = (request.kind === "module" ? "/training/" : request.kind === "agent" ? "/agents/" : "/") + data.slug;
    const duplicate = records(ITEMS, "$select=crd38_contentitemid,crd38_pageurl&$filter=crd38_pageurl eq '" + pageUrl + "'");
    if (duplicate.length || CONTENT_SEED.reservedPaths.includes(normPath(pageUrl)) || CONTENT_SEED.records.some(row => row.pageUrl && normPath(row.pageUrl) === normPath(pageUrl)))
      throw new Error("That page address is already in use. Choose another address.");
  }
  return queue(request, "save", { itemId: id, kind: request.kind, title: data.title,
    expectedRevision: expected, revision: expected + 1, displayOrder: data.displayOrder, draftJson: JSON.stringify(data),
    templateJson: checked.template ? JSON.stringify(checked.template) : "", pageUrl,
    businessId: old?.crd38_businessid || (["module", "learningPath", "testimony"].includes(request.kind) ? id : ""),
    pageId: old?.crd38_pageid || (["module", "agent", "page"].includes(request.kind) ? relatedId(id, "c011ec71") : ""),
    contentPageId: old?.crd38_contentpageid || (["module", "agent", "page"].includes(request.kind) ? relatedId(id, "c011ec72") : ""),
    mediaId: "", sourceKey: old?.crd38_sourcekey || "" });
}
function business(kind, data, id, publish) {
  const state = publish ? { statecode: 0, statuscode: 1 } : { statecode: 1, statuscode: 2 };
  if (kind === "learningPath") return { table: "crd38_learningpaths", key: "crd38_learningpathid", value: { ...state, crd38_name: data.title, crd38_description: data.description, crd38_displayorder: data.displayOrder, crd38_rolerequirement: data.roleRequirement } };
  if (kind === "module") return { table: "crd38_trainingmodules", key: "crd38_trainingmoduleid", value: { ...state, crd38_name: data.title, crd38_description: data.description, crd38_displayorder: data.displayOrder, crd38_required: data.required, "crd38_LearningPathRef@odata.bind": data.learningPathId ? "/crd38_learningpaths(" + validId(data.learningPathId) + ")" : null } };
  if (kind === "testimony") return { table: "crd38_aitestimonies", key: "crd38_aitestimonyid", value: { ...state, crd38_name: data.title, crd38_quote: data.quote, crd38_paragraphs: data.paragraphs.join("\n\n"), crd38_tags: data.tags.join(", "), crd38_imageurl: data.imageUrl } };
  return { table: "", key: "", value: {} };
}
function publish(request, publishing) {
  const item = current(validId(request.id), request.revision);
  const kind = item.crd38_kind;
  if (kind === "media") throw new Error("Images are published when uploaded. Keep them in the library while pages use them.");
  if (!publishing && !item.crd38_publishedjson) throw new Error("This content has not been published.");
  const data = json(publishing ? item.crd38_draftjson : item.crd38_publishedjson, {});
  if (publishing) {
    const check = ConnectHubContent.validate(data, kind);
    if (!check.valid) throw new Error(check.errors.join(" "));
    if (["module", "page"].includes(kind) && !data.templateKey && !data.sections.length) throw new Error("Add at least one content section before publishing.");
  }
  if (publishing && kind === "module") {
    const path = records("crd38_learningpaths", "$filter=crd38_learningpathid eq " + validId(data.learningPathId) + " and statecode eq 0&$top=1");
    if (!path.length) throw new Error("Publish the learning pathway before publishing its module.");
  }
  const source = CONTENT_SEED.records.find(row => row.sourceKey === item.crd38_sourcekey);
  const businessKind = kind === "agent" && item.crd38_businessid ? "module" : kind;
  const detail = business(businessKind, data, item.crd38_businessid, publishing);
  if (businessKind === "module") detail.value.crd38_pageurl = item.crd38_pageurl;
  const payload = { itemId: item.crd38_contentitemid, kind, title: data.title,
    expectedRevision: item.crd38_revision, revision: item.crd38_revision,
    slug: data.slug, displayOrder: data.displayOrder, pageUrl: item.crd38_pageurl || "", pageId: item.crd38_pageid || "",
    contentPageId: item.crd38_contentpageid || "", mediaId: item.crd38_mediaid || "",
    parentPageId: source?.parentPageId || (kind === "module" ? SITE.training : kind === "agent" ? SITE.agents : CONTENT_SEED.homePageId),
    pageTemplateId: source?.pageTemplateId || SITE.template,
    businessId: item.crd38_businessid || "", businessTable: detail.table, businessKey: detail.key, businessPayload: detail.value,
    html: ["module", "agent", "page"].includes(kind) && publishing ? ConnectHubContent.render(data, kind, json(item.crd38_templatejson, null)) : "",
    publishedJson: publishing ? JSON.stringify(data) : "", draftJson: item.crd38_draftjson,
    sourceKey: item.crd38_sourcekey || "" };
  return queue(request, publishing ? "publish" : "unpublish", payload);
}
function upload(request) {
  const id = validId(request.requestId);
  const mime = String(request.contentType || "");
  const bytes = String(request.base64 || "");
  if (!["image/png", "image/jpeg"].includes(mime) || bytes.length > 682668 || bytes.length * 3 / 4 - (bytes.endsWith("==") ? 2 : bytes.endsWith("=") ? 1 : 0) > 512000 || bytes.length < 32 || !/^[A-Za-z0-9+/]+={0,2}$/.test(bytes) || bytes.length % 4)
    throw new Error("Upload a PNG or JPEG image of 500 KB or less.");
  if ((mime === "image/png" && !bytes.startsWith("iVBORw0KGgo")) || (mime === "image/jpeg" && !bytes.startsWith("/9j/")))
    throw new Error("The file contents do not match the image type.");
  const title = String(request.name || "Image").trim().slice(0, 200);
  const filename = "ch-" + id + (mime === "image/png" ? ".png" : ".jpg");
  const draft = { title, description: String(request.alt || "").slice(0, 500), imageUrl: "/" + filename, displayOrder: 0 };
  return queue(request, "publish", { itemId: id, kind: "media", title, expectedRevision: 0, revision: 1,
    createIfMissing: true, draftJson: JSON.stringify(draft), publishedJson: JSON.stringify(draft),
    mediaId: relatedId(id, "c011ec73"), pageId: "", contentPageId: "", pageUrl: "/" + filename,
    parentPageId: CONTENT_SEED.homePageId, pageTemplateId: SITE.template, businessId: "", businessTable: "", businessPayload: {},
    filename, mime, base64: bytes, html: "" });
}

function importContent() {
  if (find(ITEMS, MARKER) && find(PUBLIC, MARKER)) return { imported: 0, message: "Existing content is already available." };
  // Read every source before writing. Failed/partial imports resume without replacing edits.
  const existing = new Map(records(ITEMS).map(row => [row.crd38_contentitemid, row]));
  const snapshots = new Set(records(PUBLIC, "$select=crd38_publishedcontentid").map(row => row.crd38_publishedcontentid));
  const paths = records("crd38_learningpaths");
  const modules = records("crd38_trainingmodules");
  const stories = records("crd38_aitestimonies");
  const usedModules = new Set();
  const usedStories = new Set();
  let count = 0;
  function insert(id, kind, draft, metadata, published) {
    let row = existing.get(id);
    if (!row) {
      row = { crd38_contentitemid: id, crd38_name: draft.title, crd38_kind: kind,
      crd38_draftjson: JSON.stringify(draft), crd38_publishedjson: published ? JSON.stringify(draft) : "",
      crd38_status: published ? "published" : "unpublished", crd38_revision: 1,
      crd38_publishedrevision: published ? 1 : 0, ...metadata };
      create(ITEMS, row);
      existing.set(id, row);
      count++;
    }
    if (!snapshots.has(id)) {
      create(PUBLIC, { crd38_publishedcontentid: id, crd38_name: row.crd38_name, crd38_kind: row.crd38_kind,
        crd38_publishedjson: row.crd38_publishedjson || "", crd38_status: row.crd38_status,
        crd38_pageurl: row.crd38_pageurl || "" });
      snapshots.add(id);
    }
  }
  for (const path of paths) insert(path.crd38_learningpathid, "learningPath", ConnectHubContent.normalize({
    title: path.crd38_name, description: path.crd38_description, displayOrder: path.crd38_displayorder,
    roleRequirement: path.crd38_rolerequirement }, "learningPath"),
    { crd38_businessid: path.crd38_learningpathid, crd38_sourcekey: "learningPath:" + path.crd38_learningpathid }, path.statecode !== 1);
  for (const seed of CONTENT_SEED.records) {
    const metadata = { crd38_sourcekey: seed.sourceKey, crd38_pageurl: seed.pageUrl || "",
      crd38_pageid: seed.contentPageId ? seed.sourceKey : "", crd38_contentpageid: seed.contentPageId || "",
      crd38_mediaid: seed.mediaId || "", crd38_templatejson: seed.templateKey ? JSON.stringify(CONTENT_SEED.templates[seed.templateKey]) : "" };
    let kind = seed.kind;
    const draft = { ...seed };
    let published = true;
    if (["module", "agent"].includes(seed.kind)) {
      const matches = modules.filter(row => normPath(row.crd38_pageurl) === normPath(seed.pageUrl));
      if (matches.length > 1) throw new Error("Several module records use " + seed.pageUrl + ". Resolve the duplicate before importing.");
      const module = matches[0];
      if (module) {
        metadata.crd38_businessid = module.crd38_trainingmoduleid;
        usedModules.add(module.crd38_trainingmoduleid);
        draft.learningPathId = module._crd38_learningpathref_value || "";
        draft.required = module.crd38_required === true;
        draft.displayOrder = module.crd38_displayorder || seed.displayOrder || 0;
        published = module.statecode !== 1;
      } else if (kind === "module") kind = "page";
    }
    if (seed.kind === "testimony") {
      const matches = stories.filter(row => String(row.crd38_name || "").trim().toLowerCase() === seed.title.toLowerCase());
      if (matches.length > 1) throw new Error("Several testimonies are named " + seed.title + ". Resolve the duplicate before importing.");
      const story = matches[0];
      if (story) {
        Object.assign(draft, testimonyDraft(story));
        metadata.crd38_businessid = story.crd38_aitestimonyid;
        usedStories.add(story.crd38_aitestimonyid);
        published = story.statecode !== 1;
      } else metadata.crd38_businessid = seed.itemId;
    }
    insert(seed.itemId, kind, ConnectHubContent.normalize(draft, kind), metadata, published);
  }
  for (const story of stories) {
    if (usedStories.has(story.crd38_aitestimonyid)) continue;
    if (String(story.crd38_name || "").toLowerCase() === "test" && String(story.crd38_quote || "").toLowerCase() === "test") continue;
    insert(story.crd38_aitestimonyid, "testimony", testimonyDraft(story),
      { crd38_businessid: story.crd38_aitestimonyid, crd38_sourcekey: "testimony:" + story.crd38_aitestimonyid }, story.statecode !== 1);
  }
  const missing = modules.filter(row => row.statecode !== 1 && !usedModules.has(row.crd38_trainingmoduleid));
  if (missing.length) throw new Error("Import preserved existing records, but these training pages need their source added before import can finish: " + missing.map(row => row.crd38_name).join(", "));
  if (!snapshots.has(MARKER)) create(PUBLIC, { crd38_publishedcontentid: MARKER, crd38_name: "Content import complete", crd38_kind: "system", crd38_status: "published", crd38_publishedjson: "{}" });
  if (!existing.has(MARKER)) create(ITEMS, { crd38_contentitemid: MARKER, crd38_name: "Content import complete", crd38_kind: "system",
    crd38_revision: 1, crd38_publishedrevision: 1, crd38_status: "published", crd38_draftjson: "{}", crd38_publishedjson: "{}" });
  return { imported: count, message: "Existing content is ready to edit." };
}
function testimonyDraft(row) {
  return ConnectHubContent.normalize({ title: row.crd38_name, quote: row.crd38_quote,
    paragraphs: String(row.crd38_paragraphs || "").split(/\n\s*\n/).filter(Boolean),
    tags: String(row.crd38_tags || "").split(",").map(value => value.trim()).filter(Boolean),
    imageUrl: row.crd38_imageurl || "", displayOrder: 0 }, "testimony");
}
function get() {
  try {
    if (!Server.User?.contactid) throw new Error("Sign in is required.");
    const query = Server.Context.QueryParameters || {};
    if (query.action === "getContent") {
      const row = find(ITEMS, validId(query.id));
      if (!row || !KINDS.includes(row.crd38_kind)) throw new Error("Content not found.");
      return JSON.stringify({ success: true, data: itemView(row, true) });
    }
    if (query.action === "operation") {
      const row = find(OPS, validId(query.id));
      if (!row) throw new Error("The request could not be found. Refresh the content list.");
      return JSON.stringify({ success: true, data: operationView(row) });
    }
    if (query.action !== "listContent") throw new Error("Unsupported action.");
    const rows = records(ITEMS);
    const paths = records("crd38_learningpaths", "$filter=statecode eq 0");
    return JSON.stringify({ success: true, data: { items: rows.filter(row => KINDS.includes(row.crd38_kind)).map(row => itemView(row, false)),
      learningPaths: paths.map(path => ({ id: path.crd38_learningpathid, title: path.crd38_name, name: path.crd38_name })),
      importNeeded: !rows.some(row => row.crd38_contentitemid === MARKER), sourcesReady: true } });
  } catch (error) { return JSON.stringify({ success: false, message: error.message }); }
}
function post() {
  try {
    if (!Server.User?.contactid) throw new Error("Sign in is required.");
    const body = String(Server.Context.Body || "");
    if (body.length > 900000) throw new Error("The request is too large.");
    const request = JSON.parse(body);
    const action = Server.Context.QueryParameters?.action;
    const queuedAction = { saveContent: "save", publishContent: "publish", unpublishContent: "unpublish", uploadMedia: "publish" }[action];
    if (queuedAction) {
      const previous = find(OPS, validId(request.requestId));
      if (previous) {
        const payload = json(previous.crd38_payloadjson, {});
        if (previous.crd38_action !== queuedAction || previous.crd38_requestedby !== Server.User.contactid ||
            payload.requestJson !== JSON.stringify({ ...request, base64: undefined }) ||
            (action === "uploadMedia" && payload.base64 !== request.base64))
          throw new Error("This request identifier is already in use. Reload and retry.");
        return JSON.stringify({ success: true, data: { operationId: previous.crd38_contentoperationid, itemId: previous.crd38_itemid } });
      }
    }
    let result;
    if (action === "saveContent") result = save(request);
    else if (action === "publishContent") result = publish(request, true);
    else if (action === "unpublishContent") result = publish(request, false);
    else if (action === "uploadMedia") result = upload(request);
    else if (action === "importContent") result = importContent();
    else throw new Error("Unsupported content action.");
    return JSON.stringify({ success: true, data: result });
  } catch (error) {
    Server.Logger?.Error("Content operation: " + error.message);
    return JSON.stringify({ success: false, message: error.message });
  }
}
