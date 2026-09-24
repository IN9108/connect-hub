const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = vm.createContext({});
vm.runInContext(fs.readFileSync("src/pa-knowledge-hub---knoweldgehub/web-files/content.js", "utf8"), context);
const content = context.ConnectHubContent;
const seed = JSON.parse(fs.readFileSync("power-platform/content-seed.json", "utf8"));

assert(seed.records.some((item) => item.pageUrl === "/" && item.templateKey));
assert(seed.records.some((item) => item.kind === "agent" && item.templateKey));
assert(seed.records.some((item) => item.kind === "prompt"));
assert(seed.records.some((item) => item.kind === "testimony"));
for (const item of seed.records.filter((record) => record.templateKey)) {
  const html = content.render(item, item.kind, seed.templates[item.templateKey]);
  assert(!html.includes("[[field:"), item.templateKey + " has unresolved slots");
  assert(html.length > 0, item.templateKey + " rendered empty");
}
assert(content.render({ title: "<script>", prompt: "{{7*7}}" }, "prompt").includes("&#123;&#123;7*7&#125;&#125;"));
assert(!content.validate({ title: "Unsafe", sections: [{ type: "image", url: "javascript:alert(1)" }] }, "page").valid);
assert(!content.validate({ title: "Quiz", sections: [{ type: "quiz", question: "?", answers: [{ text: "A", correct: true }, { text: "B", correct: true }] }] }, "module").valid);
assert.equal(content.safeUrl("//evil.example"), "");
assert.equal(content.safeUrl("/\\evil.example"), "");
assert.equal(content.safeUrl("https:///bad"), "");
assert(!content.validate({ title: "Path", description: "x".repeat(2001) }, "learningPath").valid);
assert(!content.validate({ title: "Story", quote: "Quote", paragraphs: ["x".repeat(2001)] }, "testimony").valid);
assert(!content.validate({ title: "Story", quote: "Quote", tags: ["x".repeat(60), "y".repeat(60)] }, "testimony").valid);
assert.equal(content.renderPage({ title: "Safe", templateKey: "x", fields: { title: "<b>{{x}}</b>", url: "javascript:alert(1)" } }, { html: '<h1>[[field:title]]</h1><a href="[[field:url:url]]">Open</a>' }), '<h1>&lt;b&gt;&#123;&#123;x&#125;&#125;&lt;/b&gt;</h1><a href="">Open</a>');
console.log(`Content renderer verified with ${seed.records.length} records and ${Object.keys(seed.templates).length} templates.`);
