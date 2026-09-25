(root => {
  "use strict";

  const kinds = new Set(["learningPath", "module", "prompt", "testimony", "agent", "page", "media"]);
  const sectionTypes = new Set(["text", "callout", "cards", "steps", "image", "quiz"]);
  const escape = (value) => String(value ?? "").replace(/[&<>"'{}]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "{": "&#123;", "}": "&#125;" })[char]);
  const safeUrl = (value) => {
    const url = String(value || "").trim();
    if (!url || /[\s\\\u0000-\u001f\u007f]/.test(url)) return "";
    if (/^#[A-Za-z][\w-]*$/.test(url)) return url;
    if (url.charAt(0) === "/" && url.charAt(1) !== "/") return url;
    if (/^https:\/\/[^/?#\s]+(?:[/?#][^\s]*)?$/i.test(url)) return url;
    return "";
  };
  const string = (value) => typeof value === "string" ? value.trim() : "";
  const list = (value) => Array.isArray(value) ? value : [];

  function normalize(data, kind) {
    const input = data && typeof data === "object" && !Array.isArray(data) ? data : {};
    const resolved = kind || input.kind;
    if (!kinds.has(resolved)) throw new Error("Unsupported content kind.");
    const result = { kind: resolved };
    for (const key of ["title", "description", "slug", "learningPathId", "roleRequirement", "category", "prompt", "quote", "imageUrl", "launchUrl", "templateKey"]) result[key] = string(input[key]);
    result.displayOrder = Number.isSafeInteger(Number(input.displayOrder)) ? Number(input.displayOrder) : 0;
    result.required = input.required === true;
    result.paragraphs = list(input.paragraphs).map(string).filter(Boolean);
    result.tags = list(input.tags).map(string).filter(Boolean);
    result.sections = list(input.sections).map((section) => ({
      type: string(section && section.type), title: string(section && section.title), body: string(section && section.body),
      items: list(section && section.items).map((item) => ({ title: string(item && item.title), body: string(item && item.body) })),
      url: string(section && section.url), alt: string(section && section.alt), question: string(section && section.question),
      answers: list(section && section.answers).map((answer) => ({ text: string(answer && answer.text), correct: answer && answer.correct === true })),
      explanation: string(section && section.explanation)
    }));
    result.fields = input.fields && typeof input.fields === "object" && !Array.isArray(input.fields) ? input.fields : {};
    return result;
  }

  function validate(data, kind) {
    let item;
    try { item = normalize(data, kind); } catch (error) { return { valid: false, errors: [error.message] }; }
    const errors = [];
    if (!item.title) errors.push("Title is required.");
    for (const [key, limit] of Object.entries({ title: 200, description: 4000, prompt: 20000, quote: 2000, slug: 200, category: 200 })) {
      if (item[key].length > limit) errors.push(key + " is too long.");
    }
    if (item.paragraphs.length > 100 || item.paragraphs.some((part) => part.length > 4000)) errors.push("Paragraphs exceed the limit.");
    if (item.tags.length > 50 || item.tags.some((tag) => tag.length > 100)) errors.push("Tags exceed the limit.");
    if (item.sections.length > 60) errors.push("Too many sections.");
    if (Object.keys(item.fields).length > 500 || Object.entries(item.fields).some(([key, value]) => !/^[a-zA-Z0-9_-]+$/.test(key) || typeof value !== "string" || value.length > 20000)) errors.push("Invalid page fields.");
    if (item.kind === "prompt" && !item.prompt) errors.push("Prompt is required.");
    if (item.kind === "testimony" && !item.quote) errors.push("Quote is required.");
    if (["learningPath", "module", "agent"].includes(item.kind) && item.description.length > 2000) errors.push("Description must be 2,000 characters or fewer.");
    if (item.kind === "learningPath" && item.roleRequirement.length > 100) errors.push("Audience must be 100 characters or fewer.");
    if (item.kind === "testimony") {
      if (item.paragraphs.join("\n\n").length > 2000) errors.push("The full testimony must be 2,000 characters or fewer.");
      if (item.tags.join(", ").length > 100) errors.push("Tags together must be 100 characters or fewer.");
      if (item.imageUrl.length > 100) errors.push("Use the image library or an image address under 101 characters.");
    }
    if (["page", "module"].includes(item.kind) && !item.templateKey && !item.sections.length && !item.paragraphs.length) errors.push("Content is required.");
    if (item.kind === "agent" && !item.templateKey && !item.sections.length && !item.description && !item.launchUrl) errors.push("Agent content is required.");
    for (const key of ["imageUrl", "launchUrl"]) if (item[key] && !safeUrl(item[key])) errors.push(key + " must be an HTTPS or local URL.");
    item.sections.forEach((section, index) => {
      if (!sectionTypes.has(section.type)) errors.push("Invalid section type at " + index + ".");
      if (section.type === "image" && !safeUrl(section.url)) errors.push("Image URL is required at " + index + ".");
      if (section.type === "quiz" && (!section.question || section.answers.length < 2 || section.answers.filter((answer) => answer.correct).length !== 1)) errors.push("Quiz needs a question and exactly one correct answer at " + index + ".");
    });
    return { valid: errors.length === 0, errors };
  }

  const paragraphs = (value) => String(value || "").split(/\n\s*\n/).filter(Boolean).map((part) => `<p>${escape(part.trim()).replace(/\n/g, "<br>")}</p>`).join("");
  const heading = (title) => title ? `<h2>${escape(title)}</h2>` : "";
  function renderSection(section) {
    const body = paragraphs(section.body);
    if (section.type === "text") return `<section class="training-section center-content">${heading(section.title)}${body}</section>`;
    if (section.type === "callout") return `<section class="training-section center-content"><div class="best-practice-panel">${heading(section.title)}${body}</div></section>`;
    if (section.type === "cards" || section.type === "steps") return `<section class="training-section center-content">${heading(section.title)}${body}<div class="branding-feature-grid">${section.items.map((item, index) => `<div class="branding-feature">${section.type === "steps" ? `<span class="branding-feature-number">${String(index + 1).padStart(2, "0")}</span>` : ""}<h3>${escape(item.title)}</h3>${paragraphs(item.body)}</div>`).join("")}</div></section>`;
    if (section.type === "image") return `<section class="training-section center-content">${heading(section.title)}<figure><img src="${escape(safeUrl(section.url))}" alt="${escape(section.alt)}" loading="lazy">${body ? `<figcaption>${body}</figcaption>` : ""}</figure></section>`;
    if (section.type === "quiz") return `<section class="training-section center-content"><div class="knowledge-check-card"><h3>${escape(section.question)}</h3><div class="knowledge-options">${section.answers.map((answer) => `<button type="button" class="knowledge-option" data-correct="${answer.correct}">${escape(answer.text)}</button>`).join("")}</div><div class="knowledge-result" role="status"></div>${section.explanation ? `<p>${escape(section.explanation)}</p>` : ""}</div></section>`;
    return "";
  }

  function render(data, kind, template) {
    const item = normalize(data, kind);
    const check = validate(item, item.kind);
    if (!check.valid) throw new Error(check.errors.join(" "));
    if (item.templateKey) return renderPage(item, template);
    if (item.kind === "prompt") return `<article class="prompt-card" data-category="${escape(item.category)}"><span class="prompt-card-tag">${escape(item.category)}</span><h3>${escape(item.title)}</h3><div class="prompt-example">${escape(item.prompt).replace(/\n/g, "<br>")}</div><div class="prompt-actions"><button type="button" class="copy-prompt-btn">Copy Prompt</button></div></article>`;
    if (item.kind === "agent") return `<div class="content-page"><div class="training-hero"><h1>${escape(item.title)}</h1>${paragraphs(item.description)}</div>${item.sections.map(renderSection).join("")}${item.launchUrl ? `<section class="training-section center-content"><a class="training-button" href="${escape(safeUrl(item.launchUrl))}">Launch agent</a></section>` : ""}</div>`;
    if (item.kind === "testimony") return `<article class="story-panel">${item.imageUrl ? `<div class="person-icon"><img src="${escape(safeUrl(item.imageUrl))}" alt="${escape(item.title)}" loading="lazy"></div>` : ""}<div class="person-name">${escape(item.title)}</div><div class="big-quote">&quot;${escape(item.quote)}&quot;</div>${item.paragraphs.map(paragraphs).join("")}<div class="story-tags">${item.tags.map((tag) => `<span>${escape(tag)}</span>`).join("")}</div></article>`;
    if (item.kind === "media") return `<article class="training-section center-content"><h2>${escape(item.title)}</h2>${item.imageUrl ? `<img src="${escape(safeUrl(item.imageUrl))}" alt="${escape(item.description)}">` : ""}${paragraphs(item.description)}</article>`;
    return `<div class="content-page"><div class="training-hero"><h1>${escape(item.title)}</h1>${paragraphs(item.description)}</div>${item.paragraphs.map(paragraphs).join("")}${item.sections.map(renderSection).join("")}${item.kind === "module" ? `<div id="moduleCompletePanel" class="training-complete" style="display:${item.sections.some((section) => section.type === "quiz") ? "none" : "block"}"><section class="training-complete center-content"><h2>Module Complete</h2></section><a href="#" id="completeModule" class="training-button">Complete Module &amp; Continue</a></div>` : ""}</div>`;
  }

  function renderCard(data, kind) {
    const item = normalize(data, kind);
    if (item.kind === "agent") return `<a class="agent-card" href="${escape(safeUrl(data.pageUrl || item.launchUrl))}"><span class="agent-title">${escape(item.title)}</span><p>${escape(item.description)}</p></a>`;
    return render(item, item.kind);
  }

  function renderPage(data, templates) {
    const item = normalize(data, "page");
    if (!item.templateKey) return render({ ...item, templateKey: "" }, "page");
    const template = templates && (templates.html ? templates : templates[item.templateKey]);
    const markup = typeof template === "string" ? template : template && template.html;
    if (typeof markup !== "string") throw new Error("Unknown page template.");
    return markup.replace(/\[\[field:([a-zA-Z0-9_-]+)(?::(url))?\]\]/g, (_, key, type) => {
      const value = Object.prototype.hasOwnProperty.call(item.fields, key) ? item.fields[key] : "";
      return escape(type === "url" ? safeUrl(value) : value);
    });
  }

  async function listItems(kind) {
    if (!["prompt", "agent", "testimony"].includes(kind)) throw new Error("Unsupported list kind.");
    const token = root.ConnectHub && await root.ConnectHub.getToken();
    const response = await fetch(`/_api/serverlogics/ContentHub?action=list&kind=${encodeURIComponent(kind)}`, {
      credentials: "same-origin", cache: "no-store", headers: token ? { __RequestVerificationToken: token } : {}
    });
    if (!response.ok) throw new Error(`Content request failed: ${response.status}`);
    const envelope = await response.json();
    if (envelope.success === false) throw new Error(envelope.message || "Content is unavailable.");
    const result = typeof envelope.data === "string" ? JSON.parse(envelope.data) : Array.isArray(envelope.data) ? envelope : envelope.data || envelope;
    if (result.success === false) throw new Error(result.message || "Content is unavailable.");
    if (!Array.isArray(result.data)) throw new Error("Invalid content response.");
    return result.data;
  }

  root.ConnectHubContent = { normalize, validate, render, renderCard, renderPage, list: listItems, escape, safeUrl };
})(typeof window !== "undefined" ? window : globalThis);
