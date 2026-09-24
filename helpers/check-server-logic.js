const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.join(__dirname, "..", "src", "pa-knowledge-hub---knoweldgehub", "server-logic");
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
      const value = entity === "contacts" ? { jobtitle: "Agent" } : moduleRecord;
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

server.Connector.Dataverse.RetrieveRecord = (entity) => JSON.stringify({ Body: JSON.stringify(entity === "contacts" ? { jobtitle: "Manager" } : moduleRecord) });
assert.equal(JSON.parse(training.post()).success, false, "Role restricted progress must be rejected");

const admin = { Server: server };
vm.runInNewContext(fs.readFileSync(path.join(root, "AdminHubMaster.js"), "utf8"), admin);
server.Context.QueryParameters = { action: "createData" };
server.Context.Body = JSON.stringify({ entityType: "learningPath", data: { name: "New journey", displayOrder: 1, description: "Description" } });
assert.equal(JSON.parse(admin.post()).success, true);
assert(calls.some(([method, entity]) => method === "create" && entity === "crd38_learningpaths"));
server.Context.Body = JSON.stringify({ entityType: "contacts", data: { name: "Unsafe" } });
assert.equal(JSON.parse(admin.post()).success, false, "Admin writes must use the table allowlist");
server.Context.Body = JSON.stringify({ entityType: "module", data: { name: "New module", displayOrder: 2, learningPathId: pathId, pageUrl: "/training/new", required: true } });
assert.equal(JSON.parse(admin.post()).success, true);
const createdModule = calls.findLast(([method, entity]) => method === "create" && entity === "crd38_trainingmodules")[2];
assert.equal(createdModule["crd38_LearningPathRef@odata.bind"], `/crd38_learningpaths(${pathId})`);
server.Context.QueryParameters.action = "deleteData";
server.Context.Body = JSON.stringify({ entityType: "module", id: moduleId });
assert.equal(JSON.parse(admin.post()).success, true);
assert(calls.some(([method, entity, id]) => method === "delete" && entity === "crd38_trainingmodules" && id === moduleId));
console.log("PASS ConnectHub server logic");
