const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "server-logic");
for (const name of ["TrainingHubMaster", "AdminHubMaster"]) {
  const source = fs.readFileSync(path.join(root, `${name}.js`), "utf8");
  assert(!/\bwith\s*\(|\bFunction\s*\(/.test(source), `${name} contains a Power Pages prohibited pattern`);
}
const contactId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const pathId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const moduleId = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const learningPath = { crd38_learningpathid: pathId, crd38_name: "Training", crd38_rolerequirement: "Agent" };
const moduleRecord = { crd38_trainingmoduleid: moduleId, crd38_name: "Basics", crd38_pageurl: "/training/basics", _crd38_learningpathref_value: pathId, crd38_required: true };
const calls = [];
const server = {
  User: { contactid: contactId },
  Context: { QueryParameters: { action: "init", currentPath: "/" }, Body: "" },
  Logger: { Log() {}, Error() {} },
  Connector: { Dataverse: {
    RetrieveRecord(entity) {
      const value = entity === "contacts" ? { jobtitle: "Agent" }
        : entity === "crd38_learningpaths" ? learningPath : moduleRecord;
      return JSON.stringify({ Body: JSON.stringify(value) });
    },
    RetrieveMultipleRecords(entity, query) {
      calls.push(["read", entity, query]);
      const value = entity === "crd38_learningpaths" ? [learningPath]
        : entity === "crd38_trainingmodules" ? [moduleRecord] : [];
      return JSON.stringify({ Body: JSON.stringify({ value }) });
    },
    CreateRecord(entity, payload) { calls.push(["create", entity, JSON.parse(payload)]); },
    UpdateRecord(entity, id, payload) { calls.push(["update", entity, id, JSON.parse(payload)]); },
    DeleteRecord(entity, id) { calls.push(["delete", entity, id]); },
  } },
};

const training = { Server: server };
vm.runInNewContext(fs.readFileSync(path.join(root, "TrainingHubMaster.js"), "utf8"), training);
const init = JSON.parse(training.get());
assert.equal(init.success, true);
assert.equal(JSON.parse(init.data).currentModule.crd38_trainingmoduleid, moduleId);
assert(calls.some(([method, entity, query]) => method === "read" && entity === "crd38_trainingprogresses" && query.includes(contactId)));

server.Context.QueryParameters = { action: "updateState", currentPath: "/training/basics", status: "189370002", moduleId };
assert.equal(JSON.parse(training.get()).success, false, "GET must not mutate progress");
assert.equal(JSON.parse(training.post()).success, true);
const progress = calls.find(([method, entity]) => method === "create" && entity === "crd38_trainingprogresses")[2];
assert.equal(progress.crd38_status, 189370002);
assert.equal(progress.crd38_completeddate, undefined, "Viewing must not mark a module complete");

server.Connector.Dataverse.RetrieveRecord = (entity) => JSON.stringify({ Body: JSON.stringify(entity === "contacts" ? { jobtitle: "Manager" }
  : entity === "crd38_learningpaths" ? learningPath : moduleRecord) });
assert.equal(JSON.parse(training.post()).success, false, "Role restricted progress must be rejected");

server.Connector.Dataverse.RetrieveRecord = (entity) => JSON.stringify({ Body: JSON.stringify(entity === "contacts" ? { jobtitle: "Agent" }
  : entity === "crd38_learningpaths" ? learningPath : { ...moduleRecord, statecode: 1 }) });
assert.equal(JSON.parse(training.post()).success, false, "Unpublished modules must reject progress writes");
server.Connector.Dataverse.RetrieveRecord = (entity) => JSON.stringify({ Body: JSON.stringify(entity === "contacts" ? { jobtitle: "Agent" }
  : entity === "crd38_learningpaths" ? { ...learningPath, statecode: 1 } : moduleRecord) });
assert.equal(JSON.parse(training.post()).success, false, "Unpublished pathways must reject progress writes");
for (const entity of ["crd38_learningpaths", "crd38_trainingmodules"])
  assert(calls.some(([method, table, query]) => method === "read" && table === entity && query.includes("statecode eq 0")), "Catalogue reads must exclude unpublished content");

const admin = { Server: server };
vm.runInNewContext(fs.readFileSync(path.join(root, "AdminHubMaster.js"), "utf8"), admin);
server.Context.QueryParameters = { action: "createData" };
server.Context.Body = JSON.stringify({ entityType: "learningPath", data: { name: "New journey", displayOrder: 1, description: "Description" } });
assert.equal(JSON.parse(admin.post()).success, false, "Legacy direct mutations must be disabled");
server.Context.Body = JSON.stringify({ entityType: "testimony", data: { name: "Colleague", quote: "Helpful", paragraph: "Saved time", photopath: "/photo.jpg", tags: "Copilot" } });
assert.equal(JSON.parse(admin.post()).success, false);
server.Context.Body = JSON.stringify({ entityType: "contacts", data: { name: "Unsafe" } });
assert.equal(JSON.parse(admin.post()).success, false, "Admin writes must use the table allowlist");
server.Context.Body = JSON.stringify({ entityType: "module", data: { name: "New module", displayOrder: 2, learningPathId: pathId, pageUrl: "/training/new", required: true } });
assert.equal(JSON.parse(admin.post()).success, false);
server.Context.QueryParameters.action = "deleteData";
server.Context.Body = JSON.stringify({ entityType: "module", id: moduleId });
assert.equal(JSON.parse(admin.post()).success, false, "Content must be unpublished without deleting progress history");
require("./check-content-server.js");
console.log("PASS ConnectHub server logic");
