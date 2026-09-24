(() => {
  const start = () => {
  "use strict";
  const root = document.getElementById("adminHub");
  if (!root) return;
  const $ = (id) => document.getElementById(id);
  const escape = (value) => ConnectHub.escapeHtml(value);
  const kinds = [
    ["learningPath", "Learning pathways"], ["module", "Training modules"],
    ["prompt", "Prompts"], ["testimony", "Testimonies"],
    ["agent", "Agents"], ["page", "Page content"]
  ];
  const kindName = (kind) => kinds.find(([key]) => key === kind)?.[1] || "Content";
  const state = {items: [], learningPaths: [], kind: "all", item: null, draft: null, dirty: false, busy: false, images: [], imageTarget: null, pending: null};
  const uuid = () => crypto.randomUUID();
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const displayName = (item) => item.name || item.draft?.title || item.draft?.name || "Untitled";
  const isImported = () => !!state.draft?.templateKey;
  const notice = (message, error = false) => { $("adminNotice").textContent = message; $("adminNotice").classList.toggle("is-error", error); };
  const actionNotice = (message, label, callback, error = false) => {
    notice(message, error);
    const button = document.createElement("button");
    button.type = "button"; button.className = "admin-button"; button.textContent = label;
    button.addEventListener("click", callback);
    $("adminNotice").append(" ", button);
  };
  const setBusy = (busy) => {
    state.busy = busy; root.classList.toggle("admin-busy", busy);
    root.querySelectorAll("button,input,select,textarea").forEach((control) => {
      if (busy) { control.dataset.wasDisabled = control.disabled ? "1" : "0"; control.disabled = true; }
      else if (control.dataset.wasDisabled !== undefined) { control.disabled = control.dataset.wasDisabled === "1"; delete control.dataset.wasDisabled; }
    });
    $("adminForm").inert = busy || !!state.pending || !!state.retry;
  };
  const pendingKey = () => window.currentContactId ? `connecthub:v1:${window.currentContactId}:adminHubPending` : null;
  const markDirty = () => { state.dirty = true; updateStatus(); };
  const setPath = (object, path, value) => {
    const parts = path.split("."); let target = object;
    while (parts.length > 1) { const key = parts.shift(); target[key] ??= /^\d+$/.test(parts[0]) ? [] : {}; target = target[key]; }
    target[parts[0]] = value;
  };
  const request = async (action, body, params = {}) => {
    const url = new URL("/_api/serverlogics/AdminHubMaster", location.origin);
    url.searchParams.set("action", action);
    url.searchParams.set("currentPath", location.pathname);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    let response;
    try { response = await fetch(url, {
      method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: {"Accept": "application/json", "OData-MaxVersion": "4.0", "OData-Version": "4.0",
        "__RequestVerificationToken": await ConnectHub.getToken(), ...(body === undefined ? {} : {"Content-Type": "application/json"})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)})
    }); } catch (error) { error.ambiguous = body !== undefined; throw error; }
    let envelope;
    try { envelope = await response.json(); }
    catch (error) { error.ambiguous = body !== undefined && response.ok; throw error; }
    let parsed;
    try { parsed = typeof envelope.data === "string" ? JSON.parse(envelope.data) : envelope.data; }
    catch (error) { error.ambiguous = body !== undefined && response.ok; throw error; }
    if (!response.ok || envelope.success !== true || parsed?.success === false) {
      const error = new Error(parsed?.message || envelope.message || `Request failed (${response.status}).`);
      error.conflict = response.status === 409 || /conflict|revision|stale/i.test(error.message);
      throw error;
    }
    return parsed?.data ?? parsed ?? envelope;
  };
  const rememberPending = (pending) => {
    state.pending = pending;
    const key = pendingKey();
    if (key) try {
      if (pending) sessionStorage.setItem(key, JSON.stringify(pending));
      else sessionStorage.removeItem(key);
    } catch (_) {}
  };
  async function finishOperation(pending) {
    rememberPending(pending);
    for (let attempt = 0; attempt < 20; attempt++) {
      const operation = await request("operation", undefined, {id: pending.operationId});
      if (operation.status === "succeeded") {
        rememberPending(null);
        await loadList();
        if (pending.action === "uploadMedia") {
          const url = operation.url || operation.pageUrl;
          if (url) {
            state.images.unshift({url, alt: pending.alt});
            if (state.draft && state.imageTarget) { setPath(state.draft, state.imageTarget, url); markDirty(); renderEditor(); }
            renderImages();
          }
          notice(url ? "Image uploaded. Select it to use it in your content." : "Image uploaded.");
        } else {
          const id = operation.itemId || pending.itemId;
          if (id) await openItem(id, true);
          notice(pending.action === "saveContent" ? "Draft saved." : pending.action === "publishContent" ? "Content published." : "Content unpublished.");
        }
        return true;
      }
      if (operation.status === "failed") {
        rememberPending(null);
        throw new Error(operation.message || "The operation failed. Your draft is still here.");
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    actionNotice("Still working. Check the result before trying again.", "Check progress", () => resumePending());
    return false;
  }
  async function resumePending() {
    if (!state.pending || state.busy) return;
    setBusy(true);
    try { await finishOperation(state.pending); }
    catch (error) {
      if (state.pending) actionNotice(error.message, "Check progress", () => resumePending(), true);
      else notice(error.message, true);
    }
    finally { setBusy(false); }
  }
  async function submitOperation(action, body) {
    if (state.pending) { notice("An operation is still running. Check its progress first.", true); return false; }
    if (state.retry) { actionNotice("Resolve the earlier request before starting another.", "Retry request", () => retryRequest(), true); return false; }
    const pending = {action, itemId: body.id, alt: body.alt, requestId: uuid()};
    body.requestId = pending.requestId;
    setBusy(true); notice("Working…");
    try {
      const result = await request(action, body);
      state.retry = null;
      if (!result.operationId) { const error = new Error("The server did not return an operation to track."); error.ambiguous = true; throw error; }
      pending.operationId = result.operationId;
      pending.itemId = result.itemId || pending.itemId;
      return await finishOperation(pending);
    } catch (error) {
      // A network failure after submission is ambiguous. Keep the same request ID for a safe retry.
      if (!pending.operationId && error.ambiguous) {
        state.retry = {action, body};
        actionNotice(`${error.message} Your changes are still here. Retry uses the same request.`, "Retry request", () => retryRequest(), true);
      } else if (state.pending) actionNotice(error.message, "Check progress", () => resumePending(), true);
      else if (error.conflict && body.id && action !== "uploadMedia") actionNotice(error.message, "Reload latest", async () => {
        if (confirm("Reload the latest version? Unsaved changes in this editor will be lost.")) await openItem(body.id, true);
      }, true);
      else notice(error.message, true);
      return false;
    } finally { setBusy(false); }
  }
  async function retryRequest() {
    if (!state.retry || state.busy || state.pending) return;
    const {action, body} = state.retry;
    setBusy(true); notice("Checking the original request…");
    try {
      const result = await request(action, body);
      if (!result.operationId) { const error = new Error("The server did not return an operation to track."); error.ambiguous = true; throw error; }
      state.retry = null;
      await finishOperation({action, itemId: result.itemId || body.id, alt: body.alt, requestId: body.requestId, operationId: result.operationId});
    } catch (error) {
      if (state.pending) actionNotice(error.message, "Check progress", () => resumePending(), true);
      else if (error.ambiguous) actionNotice(error.message, "Retry request", () => retryRequest(), true);
      else {
        state.retry = null;
        if (error.conflict && body.id && action !== "uploadMedia") actionNotice(error.message, "Reload latest", async () => {
          if (confirm("Reload the latest version? Unsaved changes in this editor will be lost.")) await openItem(body.id, true);
        }, true);
        else notice(error.message, true);
      }
    } finally { setBusy(false); }
  }
  async function loadList() {
    const data = await request("listContent");
    state.items = Array.isArray(data.items) ? data.items : [];
    state.learningPaths = Array.isArray(data.learningPaths) ? data.learningPaths : [];
    $("adminImport").hidden = !data.importNeeded;
    renderList();
    renderImages();
  }
  function renderNav() {
    $("adminNav").innerHTML = [["all", "All content"], ...kinds, ["images", "Images"]].map(([key, name]) =>
      `<button type="button" data-kind="${key}" ${state.kind === key ? 'aria-current="page"' : ""}>${name}</button>`).join("");
  }
  function renderList() {
    $("adminListTitle").textContent = state.kind === "all" ? "All content" : kindName(state.kind);
    const query = $("adminSearch").value.trim().toLowerCase();
    const filter = $("adminStatusFilter").value;
    const items = state.items.filter((item) =>
      kinds.some(([key]) => key === item.kind) &&
      (state.kind === "all" || item.kind === state.kind) &&
      (filter === "all" || item.status === filter) &&
      (!query || `${displayName(item)} ${item.draft?.description || ""}`.toLowerCase().includes(query)));
    $("adminItems").innerHTML = items.length ? items.map((item) => `<article class="admin-item">
      <div><h3>${escape(displayName(item))}</h3><p>${escape(item.draft?.description || "")}</p>
      <div class="admin-item-meta"><span class="admin-pill">${escape(kindName(item.kind))}</span><span class="admin-pill ${item.published ? "is-published" : ""}">${escape(item.status || "Draft")}</span>${item.published && window.ConnectHubContent?.safeUrl(item.pageUrl) ? `<a class="admin-pill admin-page-link" href="${escape(item.pageUrl)}" target="_blank" rel="noopener">View page</a>` : ""}</div></div>
      <button type="button" class="admin-button" data-open="${escape(item.id)}">Edit</button></article>`).join("")
      : '<div class="admin-empty">No content matches these filters.</div>';
  }
  function show(view) {
    ["List", "Editor", "Images"].forEach((name) => { $("admin" + name + "View").hidden = name.toLowerCase() !== view; });
    $("adminMain").focus();
  }
  function canLeave() { return !state.dirty || confirm("Leave this draft? Your unsaved changes will be lost."); }
  function selectKind(kind) {
    if (kind !== "images" && !canLeave()) return;
    state.kind = kind; renderNav();
    if (kind === "images") { state.imageTarget = null; renderImages(); show("images"); }
    else { if (state.dirty) state.dirty = false; renderList(); show("list"); }
  }
  async function openItem(id, force = false) {
    if (!force && !canLeave()) return;
    const item = await request("getContent", undefined, {id});
    state.item = item;
    state.draft = clone(item.draft || {});
    state.dirty = false;
    state.kind = item.kind;
    renderNav(); renderEditor(); show("editor");
  }
  function newItem(kind = "learningPath") {
    if (!canLeave()) return;
    state.item = {id: uuid(), kind, revision: 0, status: "draft", published: false};
    state.draft = {title: "", description: "", sections: []};
    state.dirty = true; state.kind = kind;
    renderNav(); renderEditor(); show("editor");
    $("adminForm").querySelector("input,textarea")?.focus();
  }
  function updateStatus() {
    const item = state.item;
    if (!item) return;
    const status = $("adminEditorStatus");
    status.textContent = `${kindName(item.kind)} · ${item.status || "Draft"}${state.dirty ? " · Unsaved changes" : ""}`;
    if (item.published && window.ConnectHubContent?.safeUrl(item.pageUrl)) {
      const link = document.createElement("a"); link.href = item.pageUrl; link.target = "_blank"; link.rel = "noopener"; link.textContent = "View page";
      status.append(" · ", link);
    }
    $("adminEditorTitle").textContent = state.draft?.title || displayName(item);
    $("adminPublishHint").textContent = state.dirty ? "Save your changes before publishing." : item.published ? "Changes to this draft are not live until you publish." : "Publish when the draft is ready.";
    $("adminDuplicate").hidden = item.revision === 0;
    $("adminUnpublish").hidden = !item.published;
    $("adminPublish").hidden = item.published && item.publishedRevision === item.revision;
  }
  const input = (path, label, value = "", options = {}) => {
    const id = `field-${path.replace(/[^a-z0-9]/gi, "-")}`;
    const val = escape(value ?? "");
    if (options.checkbox) return `<div class="admin-field ${options.full ? "full" : ""}"><label class="admin-check" for="${id}"><input id="${id}" type="checkbox" data-path="${escape(path)}" ${value ? "checked" : ""}> ${escape(label)}</label></div>`;
    const control = options.select ? `<select id="${id}" data-path="${escape(path)}">${options.select.map(([key, text]) => `<option value="${escape(key)}" ${key === value ? "selected" : ""}>${escape(text)}</option>`).join("")}</select>`
      : options.rows ? `<textarea id="${id}" data-path="${escape(path)}" rows="${options.rows}">${val}</textarea>`
      : `<input id="${id}" data-path="${escape(path)}" type="${options.type || "text"}" value="${val}" ${options.required ? "required" : ""} ${options.readonly ? "readonly" : ""}>`;
    return `<div class="admin-field ${options.full ? "full" : ""}"><label for="${id}">${escape(label)}</label>${control}${options.help ? `<small>${escape(options.help)}</small>` : ""}${options.image ? `<button type="button" class="admin-button" data-image-target="${escape(path)}">Choose from images</button>` : ""}</div>`;
  };
  const lines = (path, label, value, help) => input(path, label, (value || []).join("\n"), {rows: 4, full: true, help});
  const sectionTypes = [["text", "Text"], ["callout", "Callout"], ["cards", "Cards"], ["steps", "Steps"], ["image", "Image"], ["quiz", "Quiz"]];
  function sectionEditor(section, index) {
    const base = `sections.${index}`;
    let fields = input(`${base}.type`, "Section type", section.type || "text", {select: sectionTypes}) +
      input(`${base}.title`, "Heading", section.title || "", {full: true});
    if (["text", "callout", "image"].includes(section.type)) fields += input(`${base}.body`, "Text", section.body || "", {rows: 5, full: true});
    if (section.type === "image") fields += input(`${base}.url`, "Image", section.url || "", {image: true}) + input(`${base}.alt`, "Image description", section.alt || "");
    if (["cards", "steps"].includes(section.type)) {
      fields += `<div class="admin-field full"><label>Items</label><div class="admin-repeat">${(section.items || []).map((entry, j) =>
        `<div class="admin-section-card"><div class="admin-section-card-head"><strong>Item ${j + 1}</strong><button type="button" class="admin-button" data-remove-item="${index}:${j}">Remove</button></div><div class="admin-section-fields">${input(`${base}.items.${j}.title`, "Title", entry.title)}${input(`${base}.items.${j}.body`, "Text", entry.body, {rows: 3})}</div></div>`).join("")}</div><button type="button" class="admin-button" data-add-item="${index}">Add item</button></div>`;
    }
    if (section.type === "quiz") {
      fields += input(`${base}.question`, "Question", section.question || "", {full: true});
      fields += `<div class="admin-field full"><label>Answers</label><div class="admin-repeat">${(section.answers || []).map((answer, j) =>
        `<div class="admin-section-card"><div class="admin-section-card-head"><strong>Answer ${j + 1}</strong><button type="button" class="admin-button" data-remove-answer="${index}:${j}">Remove</button></div><div class="admin-section-fields">${input(`${base}.answers.${j}.text`, "Answer text", answer.text)}${input(`${base}.answers.${j}.correct`, "Correct answer", answer.correct, {checkbox: true})}</div></div>`).join("")}</div><button type="button" class="admin-button" data-add-answer="${index}">Add answer</button></div>`;
      fields += input(`${base}.explanation`, "Explanation", section.explanation || "", {rows: 3, full: true});
    }
    return `<div class="admin-section-card"><div class="admin-section-card-head"><h4>Section ${index + 1}</h4><div class="admin-actions"><button type="button" class="admin-button" data-move-section="${index}:-1" ${index === 0 ? "disabled" : ""}>Move up</button><button type="button" class="admin-button" data-move-section="${index}:1" ${index === state.draft.sections.length - 1 ? "disabled" : ""}>Move down</button><button type="button" class="admin-button" data-remove-section="${index}">Remove</button></div></div><div class="admin-section-fields">${fields}</div></div>`;
  }
  function renderEditor() {
    const data = state.draft, kind = state.item.kind;
    let fields = "";
    if (isImported()) {
      const descriptors = state.item.template?.editableFields || state.item.editableFields || Object.keys(data.fields || {}).map((key) => ({key, label: key.replace(/([A-Z])/g, " $1")}));
      fields = `<div class="admin-form-section"><h3>Settings</h3></div>` +
        input("description", "Description", data.description || "", {rows: 3, full: true}) +
        input("displayOrder", "Display order", data.displayOrder ?? "", {type: "number"}) +
        input("slug", "Page address", data.slug || "", {readonly: !!state.item.revision, help: state.item.revision ? "Page address is fixed after the first save." : "Optional. Created automatically when published."});
      if (kind === "module") fields += input("learningPathId", "Learning pathway", data.learningPathId || "", {select: [["", "Choose a pathway"], ...state.learningPaths.map((item) => [item.id, displayName(item)])]}) +
        input("required", "Required module", data.required || false, {checkbox: true});
      if (kind === "agent") fields += input("category", "Category", data.category || "") +
        input("launchUrl", "Launch link", data.launchUrl || "", {full: true, help: "Use an HTTPS or local page link."}) +
        input("imageUrl", "Image", data.imageUrl || "", {image: true, full: true});
      fields += `<div class="admin-form-section"><h3>Page content</h3><p>Edit the visible text and links for this page.</p></div>` +
        descriptors.map((field) => input(`fields.${field.key}`, field.label, data.fields?.[field.key] || "", {rows: field.type === "textarea" ? 5 : 0, full: true, help: field.type === "url" ? "Use an HTTPS or local page link." : ""})).join("");
    } else {
      fields = input("title", kind === "testimony" ? "Person's name" : "Title", data.title, {required: true});
      if (["module", "agent", "page"].includes(kind)) fields += input("slug", "Page address", data.slug || "", {readonly: !!state.item.revision, help: state.item.revision ? "Page address is fixed after the first save." : "Optional. Created automatically when published."});
      fields +=
        input("description", "Description", data.description || "", {rows: 4, full: true}) +
        input("displayOrder", "Display order", data.displayOrder ?? "", {type: "number"});
      if (kind === "module") fields += input("learningPathId", "Learning pathway", data.learningPathId || "", {select: [["", "Choose a pathway"], ...state.learningPaths.map((item) => [item.id, displayName(item)])]}) +
        input("required", "Required module", data.required || false, {checkbox: true});
      if (kind === "learningPath") fields += input("roleRequirement", "Audience or role", data.roleRequirement || "");
      if (kind === "prompt") fields += input("category", "Category", data.category || "") + input("prompt", "Prompt", data.prompt || "", {rows: 6, full: true});
      if (kind === "testimony") fields += input("quote", "Quote", data.quote || "", {rows: 4, full: true}) +
        lines("paragraphs", "Story paragraphs", data.paragraphs, "Write one paragraph per line.") +
        lines("tags", "Tags", data.tags, "Write one tag per line.") +
        input("imageUrl", "Portrait image", data.imageUrl || "", {image: true, full: true});
      if (kind === "agent") fields += input("category", "Category", data.category || "") +
        input("launchUrl", "Launch link", data.launchUrl || "", {full: true, help: "Use an HTTPS or local page link."}) +
        input("imageUrl", "Image", data.imageUrl || "", {image: true, full: true});
      if (["page", "module", "agent"].includes(kind)) fields += `<div class="admin-form-section"><h3>Page sections</h3><p>Add the content people will see on the page.</p><div class="admin-repeat">${(data.sections || []).map(sectionEditor).join("")}</div><div class="admin-add-row"><button type="button" class="admin-button" data-add-section>Add section</button></div></div>`;
    }
    $("adminForm").innerHTML = `<div class="admin-form-grid">${fields}</div>`;
    updateStatus();
  }
  function fieldChanged(target) {
    const path = target.dataset.path;
    if (!path || !state.draft) return;
    let value = target.type === "checkbox" ? target.checked : target.value;
    if (["tags", "paragraphs"].includes(path)) value = value.split("\n").map((line) => line.trim()).filter(Boolean);
    if (path === "displayOrder") value = value === "" ? "" : Number(value);
    setPath(state.draft, path, value);
    if (path === "fields.title") state.draft.title = value;
    if (path === "title" && state.draft.fields && Object.hasOwn(state.draft.fields, "title")) state.draft.fields.title = value;
    markDirty();
    if (path.endsWith(".type")) {
      const index = Number(path.split(".")[1]);
      state.draft.sections[index] = {type: value, title: state.draft.sections[index].title || "", items: [], answers: []};
      renderEditor();
      $(target.id)?.focus();
    }
  }
  function validate(full = false) {
    const form = $("adminForm");
    if (!form.reportValidity()) return false;
    if (!isImported() && !state.draft.title?.trim()) {
      notice("Add a title before saving.", true); form.querySelector('[data-path="title"]')?.focus(); return false;
    }
    if (full && state.item.kind === "module" && !state.draft.learningPathId) {
      notice("Choose a learning pathway for this module.", true); form.querySelector('[data-path="learningPathId"]')?.focus(); return false;
    }
    if (full && state.item.kind === "prompt" && !state.draft.prompt?.trim()) {
      notice("Add the prompt before saving.", true); form.querySelector('[data-path="prompt"]')?.focus(); return false;
    }
    if (state.draft.sections?.some((s) => s.type === "image" && s.url && !s.alt?.trim())) {
      notice("Add an image description to each image section.", true); return false;
    }
    const urls = [state.draft.imageUrl, state.draft.launchUrl, ...(state.draft.sections || []).filter((s) => s.type === "image").map((s) => s.url),
      ...(state.item.template?.editableFields || []).filter((field) => field.type === "url").map((field) => state.draft.fields?.[field.key])];
    if (urls.some((url) => url && !window.ConnectHubContent?.safeUrl(url))) {
      notice("Use HTTPS or a local page link for image and launch links.", true); return false;
    }
    if (full && window.ConnectHubContent?.validate) {
      const result = window.ConnectHubContent.validate(state.draft, state.item.kind);
      if (!result.valid) { notice(result.errors.join(" "), true); return false; }
    }
    return true;
  }
  function validateControl(target) {
    if (!target.dataset.path) return;
    const path = target.dataset.path;
    const isUrl = ["imageUrl", "launchUrl"].includes(path) || /\.url$/.test(path) ||
      (path.startsWith("fields.") && (state.item.template?.editableFields || []).some((field) => field.key === path.slice(7) && field.type === "url"));
    const message = isUrl && target.value.trim() && !window.ConnectHubContent?.safeUrl(target.value) ? "Use an HTTPS or local page link." : "";
    target.setCustomValidity(message);
    let error = target.parentElement.querySelector(".admin-error");
    if (message && !error) { error = document.createElement("small"); error.className = "admin-error"; target.parentElement.append(error); }
    if (error) { error.textContent = message; if (!message) error.remove(); }
  }
  function renderImages() {
    const images = [...state.images, ...state.items.flatMap((item) => {
      const draft = item.draft || {};
      return [draft.imageUrl, ...(draft.sections || []).filter((s) => s.type === "image").map((s) => s.url)].filter(Boolean).map((url) => ({url, alt: draft.description || draft.title || item.name || "Content image"}));
    })].filter((image, index, all) => all.findIndex((other) => other.url === image.url) === index);
    $("adminImages").innerHTML = images.length ? images.map((image, index) =>
      `<div class="admin-image-card"><img src="${escape(image.url)}" alt="${escape(image.alt)}" loading="lazy"><p>${escape(image.alt)}</p>${state.draft && state.imageTarget ? `<button class="admin-button" type="button" data-use-image="${index}">Use image</button>` : ""}</div>`).join("") : '<div class="admin-empty">No images yet. Upload the first one above.</div>';
    state.visibleImages = images;
  }
  async function fileToImage(file) {
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
    if (file.size > 20 * 1024 * 1024) throw new Error("Choose an image under 20 MB.");
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const type = file.type === "image/png" ? "image/png" : "image/jpeg";
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, type, .85));
    if (!blob) throw new Error("The image could not be prepared.");
    if (blob.size > 500 * 1024 && type === "image/png") {
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .8));
    }
    if (blob.size > 500 * 1024) {
      for (const quality of [.7, .55, .4]) {
        blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
        if (blob.size <= 500 * 1024) break;
      }
    }
    if (!blob || blob.size > 500 * 1024) throw new Error("This image could not be reduced below 500 KB. Choose a smaller image.");
    return blob;
  }
  async function upload(event) {
    event.preventDefault();
    const file = $("adminImageFile").files[0], alt = $("adminImageAlt").value.trim();
    if (!file || !alt) { $("adminUploadForm").reportValidity(); return; }
    try {
      const blob = await fileToImage(file);
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(blob);
      });
      const uploaded = await submitOperation("uploadMedia", {name: file.name.replace(/\.[^.]+$/, "") + (blob.type === "image/png" ? ".png" : ".jpg"), contentType: blob.type, base64, alt});
      if (uploaded) $("adminUploadForm").reset();
    } catch (error) { notice(error.message, true); }
  }
  root.addEventListener("input", (event) => { if (event.target.dataset.path) { fieldChanged(event.target); validateControl(event.target); } });
  root.addEventListener("change", (event) => { if (event.target.dataset.path) { fieldChanged(event.target); validateControl(event.target); } });
  root.addEventListener("click", async (event) => {
    const button = event.target.closest("button");
    if (!button || state.busy) return;
    try {
      if (button.dataset.kind) selectKind(button.dataset.kind);
      else if (button.dataset.open) await openItem(button.dataset.open);
      else if (button.id === "adminCreate") newItem($("adminNewKind").value);
      else if (button.id === "adminCreateInline") newItem(state.kind === "all" || state.kind === "images" ? $("adminNewKind").value : state.kind);
      else if (button.id === "adminBack") selectKind(state.kind);
      else if (button.id === "adminSave") { if (validate()) await submitOperation("saveContent", {id: state.item.id, kind: state.item.kind, revision: state.item.revision || 0, data: state.draft}); }
      else if (button.id === "adminPublish") {
        if (state.dirty) { notice("Save your draft before publishing.", true); return; }
        if (!validate(true)) return;
        await submitOperation("publishContent", {id: state.item.id, revision: state.item.revision});
      } else if (button.id === "adminUnpublish") {
        if (!confirm("Unpublish this content? Existing learning progress will be kept.")) return;
        await submitOperation("unpublishContent", {id: state.item.id, revision: state.item.revision});
      } else if (button.id === "adminDuplicate") {
        const copy = clone(state.draft); copy.title = (copy.title || displayName(state.item)) + " copy";
        if (["page", "module", "agent"].includes(state.item.kind)) copy.slug = "";
        if (copy.fields && Object.hasOwn(copy.fields, "title")) copy.fields.title = copy.title;
        state.item = {id: uuid(), kind: state.item.kind, revision: 0, status: "draft", published: false, template: state.item.template};
        state.draft = copy; markDirty(); renderEditor();
      } else if (button.id === "adminPreview") {
        if (!validate(true)) return;
        if (!window.ConnectHubContent?.render) throw new Error("Preview is unavailable right now.");
        const preview = $("adminDialogBody");
        preview.innerHTML = '<div class="admin-preview-frame">' + window.ConnectHubContent.render(state.draft, state.item.kind, state.item.template) + "</div>";
        preview.querySelectorAll("[id]").forEach((element) => element.removeAttribute("id"));
        preview.querySelectorAll("a").forEach((link) => { link.removeAttribute("href"); link.tabIndex = -1; });
        preview.querySelectorAll("button,input,select,textarea").forEach((control) => { control.disabled = true; control.tabIndex = -1; });
        $("adminDialog").showModal();
      } else if (button.id === "adminDialogClose") $("adminDialog").close();
      else if (button.id === "adminImport") {
        if (state.pending || state.retry) { notice("Resolve the earlier request before importing content.", true); return; }
        setBusy(true); notice("Importing existing content…");
        try { await request("importContent", {}); await loadList(); notice("Existing content imported."); }
        finally { setBusy(false); }
      } else if (button.dataset.addSection !== undefined) { state.draft.sections ||= []; state.draft.sections.push({type: "text", title: "", body: ""}); markDirty(); renderEditor(); }
      else if (button.dataset.removeSection !== undefined) { state.draft.sections.splice(Number(button.dataset.removeSection), 1); markDirty(); renderEditor(); }
      else if (button.dataset.moveSection) { const [i, direction] = button.dataset.moveSection.split(":").map(Number); const [section] = state.draft.sections.splice(i, 1); state.draft.sections.splice(i + direction, 0, section); markDirty(); renderEditor(); }
      else if (button.dataset.addItem !== undefined) { state.draft.sections[Number(button.dataset.addItem)].items.push({title: "", body: ""}); markDirty(); renderEditor(); }
      else if (button.dataset.removeItem) { const [i, j] = button.dataset.removeItem.split(":").map(Number); state.draft.sections[i].items.splice(j, 1); markDirty(); renderEditor(); }
      else if (button.dataset.addAnswer !== undefined) { state.draft.sections[Number(button.dataset.addAnswer)].answers.push({text: "", correct: false}); markDirty(); renderEditor(); }
      else if (button.dataset.removeAnswer) { const [i, j] = button.dataset.removeAnswer.split(":").map(Number); state.draft.sections[i].answers.splice(j, 1); markDirty(); renderEditor(); }
      else if (button.dataset.imageTarget) { state.imageTarget = button.dataset.imageTarget; renderImages(); show("images"); }
      else if (button.dataset.useImage !== undefined) {
        setPath(state.draft, state.imageTarget, state.visibleImages[Number(button.dataset.useImage)].url);
        markDirty(); renderEditor(); show("editor");
      }
    } catch (error) { notice(error.message, true); }
  });
  $("adminSearch").addEventListener("input", renderList);
  $("adminStatusFilter").addEventListener("change", renderList);
  $("adminUploadForm").addEventListener("submit", upload);
  $("adminForm").addEventListener("submit", (event) => event.preventDefault());
  for (const type of ["click", "submit"]) $("adminDialogBody").addEventListener(type, (event) => {
    event.preventDefault(); event.stopPropagation();
  }, true);
  window.addEventListener("beforeunload", (event) => { if (state.dirty) { event.preventDefault(); event.returnValue = ""; } });
  renderNav();
  loadList().then(() => {
    const key = pendingKey();
    if (key) try {
      const saved = sessionStorage.getItem(key);
      if (saved) { state.pending = JSON.parse(saved); notice("An earlier operation may still be running."); resumePending(); }
    } catch (_) { try { sessionStorage.removeItem(key); } catch (_) {} }
  }).catch((error) => notice(error.message, true));
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, {once: true});
  else start();
})();
