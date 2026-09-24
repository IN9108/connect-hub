const debug = true;

function get() {
  let executionTrace = [];

  function logInfo(msg) {
    executionTrace.push("[INFO] " + msg);
    if (typeof Server !== "undefined" && Server.Logger) {
      Server.Logger.Log("[AdminHub] " + msg);
    }
  }

  function logError(msg) {
    executionTrace.push("[ERROR] " + msg);
    if (typeof Server !== "undefined" && Server.Logger) {
      Server.Logger.Error("[AdminHub] " + msg);
    }
  }

  // NOTE: Verify these match your Dataverse EntitySetNames (plural names in Web API)
  const ENTITY = {
    modules: "crd38_trainingmodules",
    learningPaths: "crd38_learningpaths",
    testimonies: "crd38_aitestimonies",
  };

  // --- HELPER FUNCTIONS ---

  function fetchTableRecords(entitySetName) {
    try {
      logInfo("Querying Dataverse entity set: " + entitySetName);
      
      // Basic call signature for RetrieveMultipleRecords
      const rawResponse = Server.Connector.Dataverse.RetrieveMultipleRecords(entitySetName, "", true);

      if (!rawResponse) {
        throw new Error("Empty response returned for " + entitySetName);
      }

      let parsedOuter;
      if (typeof rawResponse === "string") {
        parsedOuter = JSON.parse(rawResponse);
      } else {
        parsedOuter = rawResponse;
      }

      // Handle envelope structure if stringified OData response Body is returned
      if (parsedOuter && parsedOuter.Body) {
        const bodyObj = typeof parsedOuter.Body === "string" ? JSON.parse(parsedOuter.Body) : parsedOuter.Body;
        if (!Array.isArray(bodyObj.value)) throw new Error("Missing records array.");
        return bodyObj.value;
      }

      if (parsedOuter && Array.isArray(parsedOuter.value)) {
        return parsedOuter.value;
      }

      if (Array.isArray(parsedOuter)) return parsedOuter;
      throw new Error("Unrecognised Dataverse response.");
    } catch (ex) {
      logError("Failed to fetch table records for " + entitySetName + ": " + (ex.message || String(ex)));
      throw ex;
    }
  }

  function handleGetAdminOverview() {
    try {
      logInfo("Fetching admin overview data...");

      const learningPaths = fetchTableRecords(ENTITY.learningPaths);
      const modules = fetchTableRecords(ENTITY.modules);
      const testimonies = fetchTableRecords(ENTITY.testimonies);

      learningPaths.sort(function(a, b) {
        var orderA = parseInt(a.crd38_displayorder, 10) || 0;
        var orderB = parseInt(b.crd38_displayorder, 10) || 0;
        return orderA - orderB;
      });

      modules.sort(function(a, b) {
        var orderA = parseInt(a.crd38_displayorder, 10) || 0;
        var orderB = parseInt(b.crd38_displayorder, 10) || 0;
        return orderA - orderB;
      });

      var reqCount = 0;
      for (var i = 0; i < modules.length; i++) {
        if (modules[i].crd38_required === true) reqCount++;
      }

      const summaryStats = {
        totalLearningJourneys: learningPaths.length,
        totalTrainingModules: modules.length,
        requiredModulesCount: reqCount,
        totalTestimonies: testimonies.length,
      };

      return {
        success: true,
        data: {
          summaryStats: summaryStats,
          learningPaths: learningPaths,
          modules: modules,
          testimonies: testimonies,
        },
        serverLogs: debug ? executionTrace : undefined,
      };
    } catch (error) {
      logError("Overview sequence failed: " + error.message);
      return {
        success: false,
        message: "Failed to fetch overview: " + error.message,
        serverLogs: debug ? executionTrace : undefined,
      };
    }
  }

  // --- ENTRY POINT ---

  try {
    logInfo("--- START GET EXECUTION ---");

    if (typeof Server === "undefined" || !Server.Context) {
      throw new Error("Server or Server.Context is unavailable.");
    }

    const action = Server.Context.QueryParameters ? Server.Context.QueryParameters["action"] : null;
    let responseObj;

    if (!action || action === "getAdminOverview") {
      responseObj = handleGetAdminOverview();
    } else {
      responseObj = {
        success: false,
        message: "Unsupported action for GET endpoint: " + action,
        serverLogs: debug ? executionTrace : undefined,
      };
    }

    return JSON.stringify(responseObj);

  } catch (globalError) {
    logError("Unhandled exception: " + globalError.message);
    return JSON.stringify({
      success: false,
      message: globalError.message,
      serverLogs: debug ? executionTrace : undefined,
    });
  }
}

function post() {
  try {
    if (!Server.User?.contactid) throw new Error("Sign in is required.");
    const action = Server.Context.QueryParameters?.action;
    const raw = String(Server.Context.Body || "");
    if (raw.length > 12000) throw new Error("Request is too large.");
    const request = JSON.parse(raw);
    const entity = {
      learningPath: ["crd38_learningpaths", "crd38_learningpathid"],
      module: ["crd38_trainingmodules", "crd38_trainingmoduleid"],
      testimony: ["crd38_aitestimonies", "crd38_aitestimonyid"],
    }[request.entityType];
    if (!entity || !["createData", "updateData", "deleteData"].includes(action))
      throw new Error("Unsupported admin action or record type.");
    const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (action !== "createData" && !guid.test(String(request.id || "")))
      throw new Error("A valid record ID is required.");

    if (action === "deleteData") {
      Server.Connector.Dataverse.DeleteRecord(entity[0], request.id);
      return JSON.stringify({ success: true });
    }

    const data = request.data || {};
    const name = String(data.name || "").trim();
    if (!name || name.length > 200) throw new Error("Name must be 1 to 200 characters.");
    const payload = { crd38_name: name };
    if (request.entityType === "testimony") {
      for (const [input, column] of [
        ["photopath", "crd38_photopath"],
        ["quote", "crd38_quote"],
        ["paragraph", "crd38_paragraph"],
        ["tags", "crd38_tags"],
      ]) payload[column] = String(data[input] || "").trim();
    } else {
      const order = Number(data.displayOrder);
      if (!Number.isInteger(order) || order < 0 || order > 100000)
        throw new Error("Display order must be a whole number from 0 to 100000.");
      payload.crd38_displayorder = order;
      payload.crd38_description = String(data.description || "").trim();
      if (request.entityType === "learningPath") {
        payload.crd38_rolerequirement = String(data.roleRequirement || "").trim();
      } else {
        const pathId = String(data.learningPathId || "");
        if (!guid.test(pathId)) throw new Error("Select a valid learning journey.");
        payload.crd38_pageurl = String(data.pageUrl || "").trim();
        if (!/^\/[A-Za-z0-9/_-]*$/.test(payload.crd38_pageurl))
          throw new Error("Page URL must be a site-relative path.");
        payload.crd38_required = data.required === true;
        payload["crd38_LearningPathRef@odata.bind"] = `/crd38_learningpaths(${pathId})`;
      }
    }

    if (action === "createData")
      Server.Connector.Dataverse.CreateRecord(entity[0], JSON.stringify(payload));
    else
      Server.Connector.Dataverse.UpdateRecord(entity[0], request.id, JSON.stringify(payload));
    return JSON.stringify({ success: true });
  } catch (error) {
    Server.Logger?.Error("AdminHub mutation failed: " + error.message);
    return JSON.stringify({ success: false, message: error.message });
  }
}
