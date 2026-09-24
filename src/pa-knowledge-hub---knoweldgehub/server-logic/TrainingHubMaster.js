/**
 * Manager Hub Core Controller Module
 * Handles API routing, Dataverse communications, user progress tracking, and access rules.
 */

const debug = true;

function get() { return handleRequest("GET"); }
function post() { return handleRequest("POST"); }

function handleRequest(method) {
  let executionTrace = [];

  /**
   * Appends an informational message to the runtime execution trace and system logger.
   * @param {string} msg - The informational message text.
   */
  function logInfo(msg) {
    executionTrace.push("[INFO] " + msg);
    if (typeof Server !== "undefined" && Server.Logger) {
      Server.Logger.Log("[ManagerHub] " + msg);
    }
  }

  /**
   * Appends an error message to the runtime execution trace and system logger.
   * @param {string} msg - The error message text.
   */
  function logError(msg) {
    executionTrace.push("[ERROR] " + msg);
    if (typeof Server !== "undefined" && Server.Logger) {
      Server.Logger.Error("[ManagerHub] " + msg);
    }
  }

  /**
   * Mapping enumeration for training progression states.
   */
  const STATUS = {
    STARTED: 189370000,
    COMPLETED: 189370001,
    VIEWED: 189370002,
  };

  /**
   * Logical table names mapping for Microsoft Dataverse entities.
   */
  const ENTITY = {
    modules: "crd38_trainingmodules",
    learningPaths: "crd38_learningpaths",
    progress: "crd38_trainingprogresses",
    testimonies: "crd38_aitestimonies",
  };

  try {
    logInfo("--- START EXECUTION ---");

    if (typeof Server === "undefined" || !Server.Context) {
      throw new Error("Server environment or Server.Context is missing.");
    }

    const action = Server.Context.QueryParameters["action"];
    logInfo("Received routing action parameter: " + (action || "none"));

    if (!action) {
      logError("Halted: Missing action parameter.");
      return JSON.stringify({
        success: false,
        message: "Missing action parameter",
        serverLogs: debug ? executionTrace : undefined,
      });
    }

    const currentPath = Server.Context.QueryParameters["currentPath"];
    if (!currentPath) {
      logError("Halted: Missing currentPath parameter.");
      return JSON.stringify({
        success: false,
        message: "Missing currentPath parameter",
        serverLogs: debug ? executionTrace : undefined,
      });
    }

    switch (action) {
      case "init":
        if (method !== "GET") throw new Error("Init requires GET.");
        return handleInit(currentPath);
      case "testimonies":
        if (method !== "GET") throw new Error("Testimonies require GET.");
        return JSON.stringify({ success: true, data: fetchTableRecords(ENTITY.testimonies, "", true) });
      case "updateState":
        if (method !== "POST") throw new Error("State changes require POST.");
        return handleUpdateState(currentPath);
      default:
        logError("Invalid action route requested: " + action);
        return JSON.stringify({
          success: false,
          message: "Invalid action parameter",
          serverLogs: debug ? executionTrace : undefined,
        });
    }
  } catch (globalError) {
    logError("CRITICAL UNHANDLED EXCEPTION: " + globalError.message);
    return JSON.stringify({
      success: false,
      message: globalError.message,
      serverLogs: debug ? executionTrace : undefined,
    });
  }

  /**
   * Retrieves multi-record sets from Dataverse with envelope parsing.
   * @param {string} entityLogicalName - The target logical table name.
   * @param {string} [selectColumns=""] - Optional column restriction string.
   * @param {boolean} [skipCacheFlag=false] - Flag to bypass local query cache.
   * @returns {Array<Object>} Parsed array of records.
   */
  function fetchTableRecords(
    entityLogicalName,
    selectColumns = "",
    skipCacheFlag = false,
  ) {
    try {
      logInfo(
        "Querying Dataverse entity: " +
          entityLogicalName +
          " (SkipCache: " +
          skipCacheFlag +
          ")",
      );
      const rawResponse = Server.Connector.Dataverse.RetrieveMultipleRecords(
        entityLogicalName,
        selectColumns,
        skipCacheFlag,
      );

      if (!rawResponse) {
        throw new Error(`Empty response returned for ${entityLogicalName}`);
      }

      const outerEnvelope = typeof rawResponse === "string"
        ? JSON.parse(rawResponse) : rawResponse;
      if (!outerEnvelope || !outerEnvelope.Body) {
        throw new Error(`Response wrapper for ${entityLogicalName} has no Body.`);
      }

      const innerBody = typeof outerEnvelope.Body === "string"
        ? JSON.parse(outerEnvelope.Body) : outerEnvelope.Body;
      if (!Array.isArray(innerBody.value))
        throw new Error(`Response for ${entityLogicalName} has no records array.`);
      return innerBody.value;
    } catch (ex) {
      logError(
        `Failed to fetch table records for ${entityLogicalName}: ` + ex.message,
      );
      throw ex;
    }
  }

  function pathAllowsJobTitle(path, jobTitle) {
    const terms = String(path.crd38_rolerequirement || "")
      .toLowerCase().split(",").map((term) => term.trim()).filter(Boolean);
    const title = String(jobTitle || "").toLowerCase();
    if (terms.some((term) => term.charAt(0) === "!" && title.includes(term.slice(1))))
      return false;
    const allowed = terms.filter((term) => term.charAt(0) !== "!");
    return !allowed.length || allowed.some((term) => title.includes(term));
  }

  /**
   * Handles initialization requests, evaluating user roles, learning paths, and progress updates.
   * @param {string} currentPath - The current navigation path context.
   * @returns {string} JSON stringified response payload.
   */
  function handleInit(currentPath) {
    try {
      logInfo("Handling init route path context: " + currentPath);

      if (!Server.User) {
        throw new Error(
          "Server.User context missing. Verify user is authenticated.",
        );
      }

      const contactId = Server.User.contactid;

      logInfo(
        "Requesting uncached real-time profile lookup for Contact ID: " +
          contactId,
      );
      const contactResponse = Server.Connector.Dataverse.RetrieveRecord(
        "contacts",
        contactId,
        "",
        true,
      );
      const liveContact = JSON.parse(JSON.parse(contactResponse).Body);

      const previousAccessDate = liveContact.crd38_lastaccessedknowledgehub
        ? new Date(liveContact.crd38_lastaccessedknowledgehub)
        : null;

      logInfo(
        "Previous Connect Hub access date: " +
          (previousAccessDate ? previousAccessDate.toISOString() : "never"),
      );

      try {
        const accessPayload = {
          crd38_lastaccessedknowledgehub: new Date().toISOString(),
        };

        Server.Connector.Dataverse.UpdateRecord(
          "contacts",
          contactId,
          JSON.stringify(accessPayload),
        );

        logInfo("Connect Hub last accessed timestamp updated in the database.");
      } catch (accessError) {
        logError(
          "Failed to update Connect Hub last accessed timestamp: " +
            accessError.message,
        );
      }

      const contactJobTitle = (liveContact.jobtitle || "").trim();
      logInfo(
        "Processing live database profile state. Current Job Title: '" +
          contactJobTitle +
          "'",
      );

      const normalizedPath = (currentPath || "")
        .toLowerCase()
        .replace(/\/$/, "");

      const learningPaths = fetchTableRecords(ENTITY.learningPaths, "$filter=statecode eq 0", true);
      const progressRecords = fetchTableRecords(
        ENTITY.progress, `$filter=_crd38_contactidref_value eq ${contactId}`, true);
      const allModules = fetchTableRecords(ENTITY.modules, "$filter=statecode eq 0", true);

      const visibleLearningPaths = learningPaths.filter((path) =>
        pathAllowsJobTitle(path, contactJobTitle));

      const visiblePathIds = new Set(
        visibleLearningPaths.map((p) => p.crd38_learningpathid),
      );

      const modules = allModules.filter((module) => {
        const pathRef = module._crd38_learningpathref_value;
        return !pathRef || visiblePathIds.has(pathRef);
      });

      modules.sort((a, b) => {
        return (
          (a.crd38_displayorder || 0) - (b.crd38_displayorder || 0) ||
          (a.crd38_name || "").localeCompare(b.crd38_name || "")
        );
      });

      const completedModuleIds = new Set(
        progressRecords
          .filter((r) => r.crd38_status === STATUS.COMPLETED)
          .map((r) => r._crd38_trainingmoduleref_value),
      );

      let currentModule = null;

      const isHomepage = normalizedPath === "" || normalizedPath === "/";

      if (isHomepage) {
        logInfo(
          "[DEBUG] User is on the homepage. Finding current module based on learning journey progression...",
        );

        const sortedLearningPaths = [...visibleLearningPaths].sort((a, b) => {
          return (
            (parseInt(a.crd38_displayorder, 10) || 0) -
            (parseInt(b.crd38_displayorder, 10) || 0)
          );
        });

        for (const learningPath of sortedLearningPaths) {
          const pathModules = modules
            .filter(
              (m) =>
                m._crd38_learningpathref_value ===
                  learningPath.crd38_learningpathid &&
                m.crd38_required === true,
            )
            .sort((a, b) => {
              return (
                (parseInt(a.crd38_displayorder, 10) || 0) -
                (parseInt(b.crd38_displayorder, 10) || 0)
              );
            });

          const firstIncompleteModule = pathModules.find(
            (m) => !completedModuleIds.has(m.crd38_trainingmoduleid),
          );

          if (firstIncompleteModule) {
            currentModule = firstIncompleteModule;

            logInfo(
              `[DEBUG] Selected current module "${currentModule.crd38_name}" from learning journey "${learningPath.crd38_name || learningPath.crd38_learningpathid}"`,
            );

            break;
          }
        }

        logInfo(
          "[DEBUG] Homepage currentModule: " +
            (currentModule
              ? `FOUND ("${currentModule.crd38_name}")`
              : "NONE (All required modules completed)"),
        );
      } else {
        currentModule =
          modules.find((m) => {
            const moduleUrl = (m.crd38_pageurl || "")
              .toLowerCase()
              .replace(/\/$/, "");

            return moduleUrl === normalizedPath;
          }) || null;

        logInfo(
          "[DEBUG] Module page currentModule: " +
            (currentModule
              ? `FOUND ("${currentModule.crd38_name}")`
              : "NOT FOUND"),
        );
      }

      let nextModule = null;

      if (currentModule) {
        const currentPathId = currentModule._crd38_learningpathref_value;

        const sortedRequiredModules = modules
          .filter(
            (m) =>
              m._crd38_learningpathref_value === currentPathId &&
              m.crd38_required === true,
          )

          .sort((a, b) => {
            const pathA = visibleLearningPaths.find(
              (p) => p.crd38_learningpathid === mPathId(a),
            );

            const pathB = visibleLearningPaths.find(
              (p) => p.crd38_learningpathid === mPathId(b),
            );

            const lpOrderA = parseInt(pathA?.crd38_displayorder, 10) || 0;

            const lpOrderB = parseInt(pathB?.crd38_displayorder, 10) || 0;

            if (lpOrderA !== lpOrderB) {
              return lpOrderA - lpOrderB;
            }

            return (
              (parseInt(a.crd38_displayorder, 10) || 0) -
              (parseInt(b.crd38_displayorder, 10) || 0)
            );
          });

        const currentIndex = sortedRequiredModules.findIndex(
          (m) =>
            m.crd38_trainingmoduleid === currentModule.crd38_trainingmoduleid,
        );

        if (
          currentIndex > -1 &&
          currentIndex < sortedRequiredModules.length - 1
        ) {
          nextModule = sortedRequiredModules[currentIndex + 1];
        }

        logInfo(
          `[DEBUG] Current Module: ${currentModule?.crd38_name || "NULL"}`,
        );

        logInfo(`[DEBUG] Next Module: ${nextModule?.crd38_name || "NULL"}`);
      }

      /**
       * Helper function to extract and normalize the learning path reference ID from a module.
       * @param {Object} module - The module object.
       * @returns {string} Lowercase path reference identifier.
       */
      function mPathId(module) {
        return String(module._crd38_learningpathref_value || "").toLowerCase();
      }

      const visibleRequiredModules = modules.filter(
        (m) => m.crd38_required === true,
      );
      const totalRequiredCount = visibleRequiredModules.length;
      const completedRequiredCount = visibleRequiredModules.filter((m) =>
        completedModuleIds.has(m.crd38_trainingmoduleid),
      ).length;

      const overallProgress = {
        completedCount: completedRequiredCount,
        totalCount: totalRequiredCount,
        percentage:
          totalRequiredCount === 0
            ? 0
            : Math.round((completedRequiredCount / totalRequiredCount) * 100),
      };

      const whatsNew = {
        hasUpdates: false,
        newLearningPaths: [],
        newModules: [],
        totalNewItems: 0,
      };

      if (previousAccessDate) {
        const newlyCreatedPaths = visibleLearningPaths.filter((path) => {
          if (!path.createdon) return false;
          return new Date(path.createdon) > previousAccessDate;
        });

        if (newlyCreatedPaths.length > 0) {
          whatsNew.newLearningPaths = newlyCreatedPaths.map((path) => ({
            id: path.crd38_learningpathid,
            name: path.crd38_name,
            createdOn: path.createdon,
          }));

          const newPathIds = new Set(
            newlyCreatedPaths.map((p) => p.crd38_learningpathid),
          );

          const newModulesInExistingPaths = modules.filter((module) => {
            const moduleCreated = module.createdon
              ? new Date(module.createdon)
              : null;

            return (
              moduleCreated &&
              moduleCreated > previousAccessDate &&
              !newPathIds.has(module._crd38_learningpathref_value)
            );
          });

          whatsNew.newModules = newModulesInExistingPaths.map((module) => ({
            id: module.crd38_trainingmoduleid,
            name: module.crd38_name,
            pathId: module._crd38_learningpathref_value,
            createdOn: module.createdon,
            pageUrl: module.crd38_pageurl,
          }));
        } else {
          whatsNew.newModules = modules
            .filter((module) => {
              if (!module.createdon) return false;
              return new Date(module.createdon) > previousAccessDate;
            })
            .map((module) => ({
              id: module.crd38_trainingmoduleid,
              name: module.crd38_name,
              pathId: module._crd38_learningpathref_value,
              createdOn: module.createdon,
              pageUrl: module.crd38_pageurl,
            }));
        }

        whatsNew.totalNewItems =
          whatsNew.newLearningPaths.length + whatsNew.newModules.length;

        whatsNew.hasUpdates = whatsNew.totalNewItems > 0;
      }

      logInfo(
        `What's New summary - Paths: ${whatsNew.newLearningPaths.length}, Modules: ${whatsNew.newModules.length}`,
      );

      logInfo(
        `Init complete. Overall Progress: ${overallProgress.percentage}%`,
      );

      return JSON.stringify({
        success: true,
        data: JSON.stringify({
          contactId,
          currentModule,
          nextModule,
          overallProgress,
          modules,
          visibleLearningPaths,
          progressRecords,
          whatsNew,
        }),
        serverLogs: debug ? executionTrace : undefined,
      });
    } catch (error) {
      logError("Init route sequence failed: " + error.message);
      return JSON.stringify({
        success: false,
        message: "Init action failed: " + error.message,
        serverLogs: debug ? executionTrace : undefined,
      });
    }
  }

  /**
   * Handles user state updates, entity progress records persistence, and role synchronization requests.
   * @param {string} currentPath - The current navigation path context.
   * @returns {string} JSON stringified response payload.
   */
  function handleUpdateState(currentPath) {
    try {
      logInfo("Handling updateState route path context: " + currentPath);

      if (!Server.User) {
        throw new Error("Server.User context missing.");
      }

      const rawStatus = Server.Context.QueryParameters["status"];

      if (rawStatus === "REFRESH_ROLE") {
        logInfo(
          "Executing Entra ID synchronization request for user profile...",
        );

        const contactId = Server.User.contactid;
        let refreshPayload = {
          crd38_refreshfromentra: true,
        };

        Server.Connector.Dataverse.UpdateRecord(
          "contacts",
          contactId,
          JSON.stringify(refreshPayload),
        );

        logInfo("Profile refresh synchronization flag set successfully.");
        return JSON.stringify({
          success: true,
          message: "Entra synchronization request submitted.",
          serverLogs: debug ? executionTrace : undefined,
        });
      }

      const targetStatus = parseInt(rawStatus, 10);
      if (!Object.values(STATUS).includes(targetStatus)) {
        throw new Error("Invalid or missing target status parameter provided.");
      }

      const contactId = Server.User.contactid;
      const passedModuleId = Server.Context.QueryParameters["moduleId"];
      const guidPattern =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

      let targetModule = null;

      if (passedModuleId && guidPattern.test(passedModuleId)) {
        logInfo(
          "Attempting direct primary key resolution for moduleId: " +
            passedModuleId,
        );

        try {
          const directRecordResponse =
            Server.Connector.Dataverse.RetrieveRecord(
              ENTITY.modules,
              passedModuleId,
              "",
              true,
            );

          if (directRecordResponse) {
            const parsedEnvelope = JSON.parse(String(directRecordResponse));
            if (parsedEnvelope && parsedEnvelope.Body) {
              targetModule = JSON.parse(parsedEnvelope.Body);
            }
          }
        } catch (fetchEx) {
          logError("Direct primary key resolution failed: " + fetchEx.message);
        }
      }

      if (!targetModule) {
        logInfo(
          "Falling back to path-based module lookup for path: " + currentPath,
        );
        const normalizedPath = (currentPath || "")
          .toLowerCase()
          .replace(/\/$/, "");

        const allModules = fetchTableRecords(ENTITY.modules, "$filter=statecode eq 0", true);
        targetModule = allModules.find((m) => {
          const moduleUrl = (m.crd38_pageurl || "")
            .toLowerCase()
            .replace(/\/$/, "");
          return moduleUrl === normalizedPath;
        });
      }

      if (!targetModule) {
        throw new Error(
          `No valid module matching identifier or path context could be identified.`,
        );
      }

      const resolvedModuleId = targetModule.crd38_trainingmoduleid;
      if (targetModule.statecode === 1) throw new Error("This module is no longer published.");
      const pathId = targetModule._crd38_learningpathref_value;
      if (pathId) {
        const contactResponse = Server.Connector.Dataverse.RetrieveRecord(
          "contacts", contactId, "$select=jobtitle", true);
        const contactEnvelope = JSON.parse(String(contactResponse));
        const contact = JSON.parse(contactEnvelope.Body);
        const pathResponse = Server.Connector.Dataverse.RetrieveRecord(
          ENTITY.learningPaths, pathId, "$select=crd38_rolerequirement,statecode", true);
        const pathEnvelope = JSON.parse(String(pathResponse));
        const path = JSON.parse(pathEnvelope.Body);
        if (!path || path.statecode === 1 || !pathAllowsJobTitle(path, contact.jobtitle))
          throw new Error("This learning journey is not available to your role.");
      }

      const progressRecords = fetchTableRecords(
        ENTITY.progress,
        `$filter=_crd38_contactidref_value eq ${contactId} and _crd38_trainingmoduleref_value eq ${resolvedModuleId}`,
        true);
      const existingRecord = progressRecords[0];

      if (existingRecord?.crd38_status === STATUS.COMPLETED &&
          targetStatus !== STATUS.COMPLETED)
        throw new Error("Completed modules cannot be moved back to an earlier state.");

      const timestamp = new Date().toISOString();
      let payload = {};

      if (existingRecord) {
        logInfo(
          `Updating existing progress entry with ID: ${existingRecord.crd38_trainingprogressid}`,
        );

        payload.crd38_status = targetStatus;
        payload.crd38_lastaccesseddate = timestamp;
        if (targetStatus === STATUS.COMPLETED) {
          payload.crd38_completeddate = timestamp;
        }

        Server.Connector.Dataverse.UpdateRecord(
          ENTITY.progress,
          existingRecord.crd38_trainingprogressid,
          JSON.stringify(payload),
        );
      } else {
        logInfo(`Creating new progress entity record execution map`);

        payload.crd38_name = targetModule.crd38_name;
        payload.crd38_status = targetStatus;
        payload.crd38_lastaccesseddate = timestamp;
        if (targetStatus === STATUS.COMPLETED)
          payload.crd38_completeddate = timestamp;

        payload["crd38_ContactIdRef@odata.bind"] = `/contacts(${contactId})`;
        payload["crd38_TrainingModuleRef@odata.bind"] =
          `/crd38_trainingmodules(${resolvedModuleId})`;

        Server.Connector.Dataverse.CreateRecord(
          ENTITY.progress,
          JSON.stringify(payload),
        );
      }

      logInfo("--- END DATA MODIFICATION UPDATE SUCCESSFULLY ---");
      return JSON.stringify({
        success: true,
        message: "State successfully persisted on the server layer.",
        serverLogs: debug ? executionTrace : undefined,
      });
    } catch (error) {
      logError("UpdateState route sequence failed: " + error.message);
      return JSON.stringify({
        success: false,
        message: "UpdateState action failed: " + error.message,
        serverLogs: debug ? executionTrace : undefined,
      });
    }
  }
}
