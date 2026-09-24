window.addEventListener("load", async () => {
  const overlay = document.getElementById("loadingOverlay");
  const statusText = document.getElementById("loadingStatusText");

  const phraseBank = [
    "Waiting for response...",
    "Validating profile records...",
    "Syncing active content paths...",
    "Building your learning hub...",
  ];

  let currentPhraseIndex = 0;
  let textCycleInterval = null;

  if (overlay && statusText) {
    textCycleInterval = setInterval(() => {
      currentPhraseIndex = (currentPhraseIndex + 1) % phraseBank.length;
      statusText.textContent = phraseBank[currentPhraseIndex];
    }, 1800);
  }

  try {
    if (!TrainingHub.state.contactId) {
      await TrainingHub.init();
    }

    const {
      modules,
      visibleLearningPaths: learningPaths,
      progressRecords: userProgress,
      overallProgress: overall,
    } = TrainingHub.state;

    const completedIds = new Set();
    const viewedIds = new Set();
    const moduleLookup = new Map();

    let latestProgressItem = null;
    let latestAccessTime = 0;

    for (const mod of modules) {
      moduleLookup.set(mod.crd38_trainingmoduleid, mod);
    }

    for (const p of userProgress) {
      const moduleId = p._crd38_trainingmoduleref_value;

      if (p.crd38_status === TrainingHub.STATUS.COMPLETED) {
        completedIds.add(moduleId);
      } else if (p.crd38_status === TrainingHub.STATUS.VIEWED) {
        viewedIds.add(moduleId);
      }

      if (p.crd38_lastaccesseddate) {
        const accessTime = new Date(p.crd38_lastaccesseddate).getTime();
        if (accessTime > latestAccessTime) {
          latestAccessTime = accessTime;
          latestProgressItem = p;
        }
      }
    }

    const overallPercentage = document.getElementById("overallPercentage");
    const overallPercentageCircle = document.getElementById(
      "overallPercentageCircle",
    );
    const completedModules = document.getElementById("completedModules");
    const remainingModules = document.getElementById("remainingModules");
    const resourceCount = document.getElementById("resourceCount");
    const completionBadge = document.getElementById("completionBadge");
    const recentActivity = document.getElementById("recentActivityText");

    if (overallPercentage && overall)
      overallPercentage.textContent = `${overall.percentage}%`;
    if (overallPercentageCircle && overall)
      overallPercentageCircle.style.background = `conic-gradient(var(--primary) 0deg, var(--primary) ${overall.percentage * 3.6}deg, rgba(255,255,255,.08) ${overall.percentage * 3.6}deg)`;
    if (completedModules && overall)
      completedModules.textContent = overall.completedCount;
    if (remainingModules && overall)
      remainingModules.textContent = Math.max(
        0,
        overall.totalCount - overall.completedCount,
      );
    if (resourceCount) resourceCount.textContent = viewedIds.size;

    if (completionBadge && overall) {
      const pct = overall.percentage;
      completionBadge.textContent =
        pct === 100
          ? "Expert"
          : pct >= 75
            ? "Advanced"
            : pct >= 25
              ? "Developing"
              : "Beginner";
    }

    if (recentActivity) {
      if (latestProgressItem) {
        const latestModule = moduleLookup.get(
          latestProgressItem._crd38_trainingmoduleref_value,
        );
        if (latestModule) {
          const formattedDate = new Date(latestAccessTime).toLocaleDateString(
            "en-GB",
          );
          recentActivity.textContent = `${latestModule.crd38_name} accessed on ${formattedDate}`;
        } else {
          recentActivity.textContent = "Recent learning activity found.";
        }
      } else {
        recentActivity.textContent = "No learning activity recorded yet.";
      }
    }

    const modulesByPath = new Map();

    const resourceItems = [];

    for (const module of modules) {
      if (module.crd38_required) {
        const pathId = module._crd38_learningpathref_value;
        if (!modulesByPath.has(pathId)) {
          modulesByPath.set(pathId, []);
        }
        modulesByPath.get(pathId).push(module);
      } else {
        resourceItems.push(module);
      }
    }

    const structuralTracks = learningPaths
      .sort(
        (a, b) => (a.crd38_displayorder || 999) - (b.crd38_displayorder || 999),
      )
      .reduce((acc, path) => {
        const pathModules = modulesByPath.get(path.crd38_learningpathid) || [];
        if (pathModules.length === 0) return acc;

        let completedCount = 0;
        for (const module of pathModules) {
          if (completedIds.has(module.crd38_trainingmoduleid)) {
            completedCount++;
          }
        }

        const totalCount = pathModules.length;

        acc.push({
          id: path.crd38_learningpathid,
          name: path.crd38_name,
          description: path.crd38_description,
          modules: pathModules,
          percentage: Math.round((completedCount / totalCount) * 100),
          isComplete: completedCount === totalCount,
        });

        return acc;
      }, []);

    const activeTrack =
      structuralTracks.find((t) => !t.isComplete) ||
      structuralTracks[structuralTracks.length - 1];

    if (activeTrack) {
      const pathTitle = document.getElementById("dynamicPathTitle");
      const pathDesc = document.getElementById("dynamicPathDesc");
      const trainingPercentage = document.getElementById("trainingPercentage");
      const trainingFill = document.getElementById("trainingFill");
      const trainingStatus = document.getElementById("trainingStatus");

      if (pathTitle) pathTitle.textContent = activeTrack.name;
      if (pathDesc)
        pathDesc.textContent =
          activeTrack.description || "Structured track progression assignment.";
      if (trainingPercentage)
        trainingPercentage.textContent = `${activeTrack.percentage}%`;
      if (trainingFill) trainingFill.style.width = `${activeTrack.percentage}%`;

      if (trainingStatus) {
        if (activeTrack.isComplete) {
          trainingStatus.textContent = "Completed";
          trainingStatus.style.cssText = "background: #dcfce7; color: #166534;";
        } else if (activeTrack.percentage >= 50) {
          trainingStatus.textContent = "On Track";
          trainingStatus.style.cssText = "background: #dbeafe; color: #1d4ed8;";
        } else {
          trainingStatus.textContent = "In Progress";
          trainingStatus.style.cssText = "background: #eef7d7; color: #517b00;";
        }
      }

      const currentModule = TrainingHub.getCurrentModule();
      const nextIncompleteModule = TrainingHub.getNextModule();
      const cardUrl =
        nextIncompleteModule?.crd38_pageurl ||
        activeTrack.modules[0]?.crd38_pageurl;
      const activeCard = document.getElementById("dynamicActivePathCard");

      if (activeCard && cardUrl) activeCard.href = cardUrl;

      const detailsContainer = document.getElementById("learningPathDetails");
      if (detailsContainer) {
        const fragment = document.createDocumentFragment();

        for (const module of activeTrack.modules) {
          const complete = completedIds.has(module.crd38_trainingmoduleid);
          const row = document.createElement("div");
          row.className = complete
            ? "learning-item completed"
            : "learning-item learning-item-pending";
          row.innerHTML = `
            <div class="learning-item-title">${complete ? "✓" : "○"} ${module.crd38_name}</div>
            <div class="learning-item-status">${complete ? "Completed" : "Pending"}</div>`;
          fragment.appendChild(row);
        }

        detailsContainer.innerHTML = "";
        detailsContainer.appendChild(fragment);
      }

      const nextStepText = document.getElementById("nextStepText");
      const nextStepButton = document.getElementById("nextStepButton");

      if (nextStepText && nextStepButton && overall) {
        const currentModuleCompleted =
          currentModule &&
          completedIds.has(currentModule.crd38_trainingmoduleid);

        // Entire training programme complete
        if (
          !currentModule &&
          !nextIncompleteModule &&
          overall.percentage === 100
        ) {
          //find the next Resource module that has not been viewed. If all have been viewed, then just show a random resource module
          const unviewedResource = resourceItems.find(
            (item) => !viewedIds.has(item.crd38_trainingmoduleid),
          );

          if (unviewedResource) {
            nextStepText.textContent =
              "You've completed all required training paths! Continue exploring extra resources and tools.";
            nextStepButton.href = unviewedResource.crd38_pageurl;
            nextStepButton.textContent = "Explore Resources";
          } else {
            nextStepText.textContent =
              "You've completed all required training paths! Continue exploring extra resources and tools.";
            nextStepButton.href = resourceItems[0]?.crd38_pageurl || "#";
            nextStepButton.textContent = "Explore Resources";
          }
        }

        else if (
          !nextIncompleteModule &&
          currentModule &&
          !currentModuleCompleted
        ) {
          nextStepText.textContent = currentModule.crd38_name;
          nextStepButton.href = currentModule.crd38_pageurl;
        }

        // Normal progression case
        else if (nextIncompleteModule) {
          nextStepText.textContent = nextIncompleteModule.crd38_name;
          nextStepButton.href = nextIncompleteModule.crd38_pageurl;
        }
      }
    }

    const resourcesContainer = document.getElementById(
      "dynamicResourcesContainer",
    );
    if (resourcesContainer) {
      if (resourceItems.length === 0) {
        resourcesContainer.innerHTML =
          '<div class="loading-state">No dynamic resources published.</div>';
      } else {
        const fragment = document.createDocumentFragment();

        for (const item of resourceItems) {
          const card = document.createElement("a");
          card.href = item.crd38_pageurl || "#";
          card.className = "resource-card";
          card.innerHTML = `
            <h3>${item.crd38_name}</h3>
            <p>${item.crd38_description || "Supplementary handbook reference and practice tools."}</p>
            ${viewedIds.has(item.crd38_trainingmoduleid) ? '<div class="resource-viewed-badge">Viewed</div>' : ""}`;
          fragment.appendChild(card);
        }

        resourcesContainer.innerHTML = "";
        resourcesContainer.appendChild(fragment);
      }
    }
  } catch (err) {
    console.error(
      "Homepage Dashboard failed to load configuration state:",
      err,
    );
  } finally {
    if (textCycleInterval) clearInterval(textCycleInterval);
    if (overlay) overlay.classList.add("hidden");
  }
});
