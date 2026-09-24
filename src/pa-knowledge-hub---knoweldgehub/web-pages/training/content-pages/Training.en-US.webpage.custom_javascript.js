window.addEventListener("load", async () => {
  const pathsContainer = document.getElementById(
    "dynamicLearningPathsContainer",
  );
  if (!pathsContainer) return;

  const getLoadingTemplate = (
    title = "Refreshing your role",
    subtitle = "Checking for updated learning journeys...",
  ) => `
    <div class="loading-state">
      <div class="loading-spinner"></div>
      <div class="loading-title">${title}</div>
      <div class="loading-subtitle">${subtitle}</div>
    </div>`;

  /**
   * Render dashboard helper with client-side sorting safely applied
   */
  function renderDashboardData(state) {
    const {
      modules,
      visibleLearningPaths: learningPaths,
      progressRecords: userProgress,
      overallProgress: overall,
    } = state;

    const overallPercentage = overall?.percentage || 0;
    const progressPercentageEl = document.getElementById("progressPercentage");
    const progressFill = document.getElementById("progressFill");

    if (progressPercentageEl)
      progressPercentageEl.textContent = `${overallPercentage}%`;
    if (progressFill) progressFill.style.width = `${overallPercentage}%`;

    const completedIds = new Set(
      userProgress
        .filter((r) => r.crd38_status === TrainingHub.STATUS.COMPLETED)
        .map((r) => r._crd38_trainingmoduleref_value),
    );

    const modulesByPath = new Map();
    for (const module of modules) {
      if (module.crd38_required) {
        const pathId = module._crd38_learningpathref_value;
        if (!modulesByPath.has(pathId)) modulesByPath.set(pathId, []);
        modulesByPath.get(pathId).push(module);
      }
    }

    // Client-side sort fallback: sort by display order ascending (smallest first)
    const sortedLearningPaths = [...(learningPaths || [])].sort((a, b) => {
      const orderA = a.crd38_displayorder ?? a.displayorder ?? 0;
      const orderB = b.crd38_displayorder ?? b.displayorder ?? 0;
      return orderA - orderB;
    });

    const fragment = document.createDocumentFragment();
    let renderedCards = 0;

    for (const path of sortedLearningPaths) {
      const pathModules = modulesByPath.get(path.crd38_learningpathid) || [];
      const totalCount = pathModules.length;
      if (totalCount === 0) continue;

      let completedCount = 0;
      let nextModule = null;

      for (const module of pathModules) {
        if (completedIds.has(module.crd38_trainingmoduleid)) {
          completedCount++;
        } else if (!nextModule) {
          nextModule = module;
        }
      }

      const percentage = Math.round((completedCount / totalCount) * 100);
      const isComplete = completedCount === totalCount;

      let statusText = "In Progress";
      let pillBg = "#eef7d7";
      let pillColor = "#517b00";

      if (isComplete) {
        statusText = "Completed";
        pillBg = "#dcfce7";
        pillColor = "#166534";
      } else if (percentage >= 50) {
        statusText = "On Track";
        pillBg = "#dbeafe";
        pillColor = "#1d4ed8";
      }

      const targetUrl =
        nextModule?.crd38_pageurl || pathModules[0]?.crd38_pageurl || "#";

      const estimatedMinutes = totalCount * 2;

      const card = document.createElement("a");
      card.href = ConnectHub.sitePath(targetUrl);
      card.className = "learning-path-card";
      card.innerHTML = `
    <div>
        <div class="path-header">
            <div>
                <h3>${ConnectHub.escapeHtml(path.crd38_name || "")}</h3>

                <br/>
                <br/>

                <div class="path-meta">
                    <span class="path-duration">
                        Est. ${estimatedMinutes} mins
                    </span>
                </div>
            </div>

            <span class="status-pill" style="background:${pillBg};color:${pillColor};">
                ${statusText}
            </span>
        </div>
    </div>

    <div class="path-progress">
        <div class="path-progress-top">
            <span>Track Progress (${completedCount}/${totalCount})</span>
            <span>${percentage}%</span>
        </div>

        <div class="progress-bar">
            <div class="progress-fill" style="width:${percentage}%"></div>
        </div>
    </div>`;

      fragment.appendChild(card);
      renderedCards++;
    }

    pathsContainer.innerHTML = "";
    if (renderedCards === 0) {
      pathsContainer.innerHTML =
        '<div class="loading-state">No active tracks assigned to your profile.</div>';
      return;
    }
    pathsContainer.appendChild(fragment);
  }

  /**
   * Synchronizes data layers and handles card rendering sequences
   */
  async function loadDashboard() {
    pathsContainer.innerHTML = getLoadingTemplate(
      "Loading courses",
      "Assembling your personalized learning journeys...",
    );
    try {
      const state = await TrainingHub.init();
      renderDashboardData(state);
    } catch (error) {
      console.error("Critical rendering error on Training dashboard:", error);
      pathsContainer.innerHTML =
        '<div class="loading-state" style="color:#ef4444;">Failed to sync with tracking tables.</div>';
    }
  }

  /**
   * Action click handler for Profile/Entra Sync refreshes
   */
  document
    .getElementById("refreshRoleButton")
    ?.addEventListener("click", async (e) => {
      const button = e.currentTarget;
      const originalText = button.textContent;

      try {
        button.disabled = true;
        button.textContent = "Refreshing...";
        pathsContainer.innerHTML = getLoadingTemplate();

        await TrainingHub._callServer("updateState", "&status=REFRESH_ROLE");

        const maxAttempts = 25;
        for (let i = 0; i < maxAttempts; i++) {
          const state = await TrainingHub.init(true);

          if (state.modules && state.modules.length > 0) {
            renderDashboardData(state);
            return;
          }

          const delay = i < 5 ? 1000 : i < 15 ? 1500 : 2000;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        console.warn(
          "[Role Refresh] Timed out waiting for backend synchronization.",
        );
        pathsContainer.innerHTML = `
        <div class="timeout-state">
          <h3>Role refresh is taking longer than expected</h3>
          <p>Please wait a few moments and press <strong>Refresh My Role</strong> again.</p>
        </div>`;
      } catch (err) {
        console.error("[Role Refresh] Failed:", err);
        pathsContainer.innerHTML =
          '<div class="loading-state" style="color:#ef4444;">Failed to refresh profile.</div>';
      } finally {
        button.disabled = false;
        button.textContent = originalText;
      }
    });

  // Main UI Entry Execution point
  await loadDashboard();
});
