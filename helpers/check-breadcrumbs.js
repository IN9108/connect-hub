const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const header = fs.readFileSync(path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "web-templates", "header", "Header.webtemplate.source.html"), "utf8");
const script = header.match(/<nav class="hub-breadcrumb"[\s\S]*?<script>([\s\S]*?)<\/script>/)?.[1];
assert(script, "Shared header breadcrumb script exists");

function render(pathname, heading) {
  const list = { children: [], append(child) { this.children.push(child); } };
  const nav = { hidden: true, querySelector() { return list; } };
  let ready;
  const document = {
    addEventListener(_event, callback) { ready = callback; },
    querySelector(selector) { return selector === ".hub-breadcrumb" ? nav : heading ? { textContent: heading } : null; },
    createElement() { return { children: [], append(child) { this.children.push(child); }, setAttribute(name, value) { this[name] = value; } }; },
  };
  vm.runInNewContext(script, { document, location: { pathname } });
  ready();
  return { nav, items: list.children };
}

assert.equal(render("/admin/").nav.hidden, true);
assert.equal(render("/").nav.hidden, true);
const nested = render("/training/bk-differences/", "Branding Kits In Action");
assert.equal(nested.nav.hidden, false);
assert.deepEqual(nested.items.map(item => item.children[0]?.href || item.textContent), ["/", "/training/", "Branding Kits In Action"]);
assert.equal(nested.items[2]["aria-current"], "page");
assert.equal(render("/en-US/training/ai-fundamentals/", "Your Introduction to AI").items[0].children[0].href, "/en-US/");
console.log("PASS ConnectHub breadcrumbs");
