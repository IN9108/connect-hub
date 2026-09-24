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
      const rawResponse = Server.Connector.Dataverse.RetrieveMultipleRecords(entitySetName);

      if (!rawResponse) {
        logInfo("Null response returned for " + entitySetName);
        return [];
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
        return Array.isArray(bodyObj.value) ? bodyObj.value : [];
      }

      if (parsedOuter && Array.isArray(parsedOuter.value)) {
        return parsedOuter.value;
      }

      return Array.isArray(parsedOuter) ? parsedOuter : [];
    } catch (ex) {
      logError("Failed to fetch table records for " + entitySetName + ": " + (ex.message || String(ex)));
      return [];
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