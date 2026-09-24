window.ConnectHub = window.ConnectHub || {};

(() => {
  const root = document.documentElement;
  const key = "connectHubTheme";
  let saved;
  try { saved = localStorage.getItem(key); } catch (_) {}
  const preferred = saved === "dark" ? "dark" : "light";
  function setTheme(theme, persist = false) {
    root.dataset.theme = theme;
    const button = document.getElementById("themeToggle");
    if (button) {
      button.setAttribute("aria-pressed", String(theme === "dark"));
      button.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
      button.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
    }
    if (persist) try { localStorage.setItem(key, theme); } catch (_) {}
  }
  setTheme(preferred);
  document.addEventListener("DOMContentLoaded", () => {
    setTheme(root.dataset.theme);
    document.getElementById("themeToggle")?.addEventListener("click", () =>
      setTheme(root.dataset.theme === "dark" ? "light" : "dark", true));
  });
  window.ConnectHub.setTheme = setTheme;
})();

window.ConnectHub.getToken = async function () {
  if (window.shell?.getTokenDeferred) {
    return new Promise((resolve, reject) =>
      window.shell.getTokenDeferred().done(resolve).fail(reject));
  }
  const token = document.querySelector('input[name="__RequestVerificationToken"]')?.value;
  if (!token) throw new Error("Request verification token is unavailable.");
  return token;
};

window.ConnectHub.escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;")
  .replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");
window.ConnectHub.sitePath = (value) =>
  typeof value === "string" && /^\/(?!\/)[A-Za-z0-9/_-]*\/?$/.test(value)
    ? value : "#";

window.ConnectHub.cache = (() => {
  const pending = new Map();
  const versions = new Map();
  const lifetime = 15 * 60 * 1000;
  const prefix = () => window.currentContactId ? `connecthub:v1:${window.currentContactId}:` : "";
  return {
    has(key) {
      if (!prefix()) return false;
      try {
        const saved = JSON.parse(sessionStorage.getItem(prefix() + key));
        return !!saved && Date.now() - saved.time < lifetime;
      } catch (_) { return false; }
    },
    async get(key, load, force = false) {
      const storageKey = prefix() + key;
      let saved;
      if (!force && prefix()) {
        try {
          saved = JSON.parse(sessionStorage.getItem(storageKey));
          if (saved && Date.now() - saved.time < lifetime) return saved.value;
        } catch (_) {}
      }
      if (pending.has(storageKey)) return pending.get(storageKey);
      const version = versions.get(storageKey) || 0;
      const request = Promise.resolve().then(load).then(value => {
        if (prefix() && (versions.get(storageKey) || 0) === version) try {
          sessionStorage.setItem(storageKey, JSON.stringify({ time: Date.now(), value }));
        } catch (_) {}
        return value;
      }).catch(error => {
        if (!force && saved && Date.now() - saved.time < 24 * 60 * 60 * 1000)
          return saved.value;
        throw error;
      }).finally(() => {
        if (pending.get(storageKey) === request) pending.delete(storageKey);
      });
      pending.set(storageKey, request);
      return request;
    },
    invalidate(key) {
      if (!prefix()) return;
      const target = prefix() + key;
      let stored = [];
      try { stored = Object.keys(sessionStorage); } catch (_) {}
      for (const storageKey of new Set([...stored, ...pending.keys()])) {
        if (!storageKey.startsWith(target)) continue;
        versions.set(storageKey, (versions.get(storageKey) || 0) + 1);
        try { sessionStorage.removeItem(storageKey); } catch (_) {}
        pending.delete(storageKey);
      }
    },
  };
})();

window.TrainingHub = {
  processing: false,
  _initPromise: null,
  state: {
    contactId: null,
    currentModule: null,
    nextModule: null,
    overallProgress: null,
    modules: [],
    visibleLearningPaths: [],
    progressRecords: [],
    whatsNew: null,
  },

  STATUS: {
    STARTED: 189370000,
    COMPLETED: 189370001,
    VIEWED: 189370002,
  },

  CONFIG: {
    storageKey: "lh_dismissed_notifications",
    initialDelay: 2000,
  },

  async _callServer(action, extraParams = "", url = null) {
    const currentPath = window.location.pathname;
    if (!url)
      url = `/_api/serverlogics/TrainingHubMaster?action=${action}&currentPath=${encodeURIComponent(currentPath)}${extraParams}`;

    const changingState = action === "updateState";
    const response = await fetch(url, {
      method: changingState ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "OData-MaxVersion": "4.0",
        "OData-Version": "4.0",
        __RequestVerificationToken: await ConnectHub.getToken(),
        ...(changingState ? { "Content-Type": "application/json" } : {}),
      },
      ...(changingState ? { body: "{}" } : {}),
    });

    if (!response.ok) {
      throw new Error(
        `Server request failed with status code ${response.status}`,
      );
    }

    const envelope = await response.json();
    if (envelope.success === false)
      throw new Error(envelope.message || "Server request failed.");
    const parsedData = typeof envelope.data === "string"
      ? JSON.parse(envelope.data) : envelope.data;

    if (!parsedData || parsedData.success !== true) {
      throw new Error(
        parsedData.message ||
          "An error occurred inside the server script execution routine.",
      );
    }

    return parsedData;
  },

  async init(force = false) {
    if (this._initPromise) {
      return this._initPromise;
    }

    this._initPromise = (async () => {
      try {
        const dashboard = /^\/(?:training\/?)?$/i.test(window.location.pathname);
        const serverResult = await ConnectHub.cache.get(
          dashboard ? "training:dashboard" : `training:${window.location.pathname.toLowerCase()}`,
          () => this._callServer("init", "", dashboard
            ? "/_api/serverlogics/TrainingHubMaster?action=init&currentPath=%2F" : null),
          force,
        );

        if (typeof serverResult.data === "string") {
          this.state = JSON.parse(serverResult.data);
        } else {
          this.state = serverResult.data;
        }

        if (this.state.whatsNew) {
          setTimeout(() => {
            this._checkAndShowNotification(this.state.whatsNew);
          }, this.CONFIG.initialDelay);
        }

        return this.state;
      } catch (err) {
        throw err;
      } finally {
        window.TrainingHub._initPromise = null;
      }
    })();

    return this._initPromise;
  },

  /**
   * Updates state on the server using an explicit moduleId parameter.
   * @param {number} statusCode - The status enum value (STARTED, COMPLETED, VIEWED).
   * @param {string} [moduleId] - (Optional) Target module GUID. Defaults to active module ID.
   */
  async updateState(statusCode, moduleId) {
    try {
      const targetModuleId =
        moduleId || this.getCurrentModule()?.crd38_trainingmoduleid;

      let extraParams = `&status=${statusCode}`;
      if (targetModuleId) {
        extraParams += `&moduleId=${encodeURIComponent(targetModuleId)}`;
      }

      await this._callServer("updateState", extraParams);
      ConnectHub.cache.invalidate("training:");
    } catch (err) {
      throw err;
    }
  },

  getCurrentModule() {
    return this.state.currentModule;
  },
  getNextModule() {
    return this.state.nextModule;
  },
  getModules() {
    return this.state.modules;
  },
  getLearningPaths() {
    return this.state.visibleLearningPaths;
  },
  getOverallProgress() {
    return this.state.overallProgress;
  },

  async completeAndContinue() {
    if (this.processing) return;
    this.processing = true;

    try {
      const current = this.getCurrentModule();
      if (!current) {
        throw new Error(
          `No localized module schema could be mapped for path context: ${window.location.pathname}`,
        );
      }

      const next = this.getNextModule();

      await this.updateState(
        this.STATUS.COMPLETED,
        current.crd38_trainingmoduleid,
      );

      if (next && ConnectHub.sitePath(next.crd38_pageurl) !== "#") {
        window.location.href = next.crd38_pageurl;
      } else if (current.crd38_pageurl) {
        const rootMatch = ConnectHub.sitePath(current.crd38_pageurl).match(/^\/([^/]+)/);
        window.location.href = rootMatch ? `/${rootMatch[1]}/` : "/";
      } else {
        window.location.href = "/";
      }
    } finally {
      this.processing = false;
    }
  },

  checkAllKnowledgeChecksCompleted() {
    const checks = document.querySelectorAll(".knowledge-check-card");

    if (!checks.length) return;

    const allAnswered = [...checks].every(
      (check) =>
        check.querySelectorAll(".knowledge-option:disabled").length > 0,
    );

    if (!allAnswered) return;

    const completePanel = document.getElementById("moduleCompletePanel");

    if (!completePanel) return;

    if (!completePanel.querySelector(".return-to-top")) {
      const topLink = document.createElement("a");
      topLink.className = "return-to-top";
      topLink.href = "#";
      topLink.textContent = "Return to top";
      completePanel.appendChild(topLink);
    }

    completePanel.style.display = "block";

    setTimeout(() => {
      completePanel.classList.add("visible");
    }, 50);
  },

  handleKnowledgeCheck(selectedButton) {
    const card = selectedButton.closest(".knowledge-check-card");
    if (!card) return;

    const result = card.querySelector(".knowledge-result");
    const options = card.querySelectorAll(".knowledge-option");

    const isCorrect = selectedButton.dataset.correct === "true";

    let correctAnswer = "";

    options.forEach((option) => {
      option.disabled = true;

      if (option.dataset.correct === "true") {
        correctAnswer = option.textContent.trim();
        option.classList.add("correct");
      }
    });

    if (!isCorrect) {
      selectedButton.classList.add("incorrect");

      if (result) {
        result.innerHTML = `Not quite. The correct answer is <strong>${correctAnswer}</strong>`;
      }
    } else {
      if (result) {
        result.innerHTML = "Correct!";
      }
    }

    this.checkAllKnowledgeChecksCompleted();
  },

  _checkAndShowNotification(whatsNew) {
    if (!whatsNew || !whatsNew.hasUpdates) return;

    const dismissedIds = JSON.parse(
      sessionStorage.getItem(this.CONFIG.storageKey) || "[]",
    );

    const payloadFootprint = [
      ...whatsNew.newLearningPaths.map((p) => p.id),
      ...whatsNew.newModules.map((m) => m.id),
    ].join("|");

    if (dismissedIds.includes(payloadFootprint)) {
      return;
    }

    let titleText = "New Resources Available!";
    let descText = "";
    let actionUrl = "/training";

    if (whatsNew.newLearningPaths.length > 0) {
      const count = whatsNew.newLearningPaths.length;
      const firstName = whatsNew.newLearningPaths[0].name || "Learning journey";

      titleText =
        count === 1 ? "New Learning Journey!" : "New Journeys Unlocked!";
      descText =
        count === 1
          ? `"${firstName}" is now available. Start tracking your progress today.`
          : `We just launched ${count} new journeys to build your capabilities.`;
    } else if (whatsNew.newModules.length > 0) {
      const count = whatsNew.newModules.length;
      const firstName = whatsNew.newModules[0].name || "Module";

      titleText = count === 1 ? "New Module Added!" : "New Modules Released!";
      descText =
        count === 1
          ? `"${firstName}" has been added to your journeys.`
          : `${count} new guided modules are ready. Check out the latest resources.`;

      if (count === 1 && whatsNew.newModules[0].pageUrl) {
        actionUrl = whatsNew.newModules[0].pageUrl;
      }
    }

    const container = document.createElement("div");
    container.className = "lh-notification-toast";

    container.innerHTML = `
      <div class="lh-toast-accent-line"></div>
      <div class="lh-toast-body">
        <div class="lh-toast-icon-wrapper">
          <div class="lh-toast-pulse"></div>
          <svg class="lh-toast-svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
            <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
          </svg>
        </div>
        <div class="lh-toast-content">
          <h4 class="lh-toast-title">${ConnectHub.escapeHtml(titleText)}</h4>
          <p class="lh-toast-desc">${ConnectHub.escapeHtml(descText)}</p>
        </div>
        <div class="lh-toast-actions">
          <a href="${ConnectHub.sitePath(actionUrl)}" class="lh-toast-btn-action">Explore</a>
          <button type="button" class="lh-toast-btn-close" aria-label="Dismiss notification">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    const closeBtn = container.querySelector(".lh-toast-btn-close");
    closeBtn.addEventListener("click", () => {
      container.classList.add("lh-dismissing");

      dismissedIds.push(payloadFootprint);
      sessionStorage.setItem(
        this.CONFIG.storageKey,
        JSON.stringify(dismissedIds),
      );

      container.addEventListener("transitionend", () => {
        container.remove();
      });
    });

    document.body.appendChild(container);

    requestAnimationFrame(() => {
      container.classList.add("lh-visible");
    });
  },

};

window.addEventListener("DOMContentLoaded", async () => {
  if (/^\/admin(?:-dashboard)?(?:\/|$|\.)/i.test(window.location.pathname)) {
    return;
  }

  try {
    await TrainingHub.init();

    const activeModule = TrainingHub.getCurrentModule();
    if (activeModule) {
      const existingProgress = TrainingHub.state.progressRecords.find(
        (r) =>
          r._crd38_trainingmoduleref_value ===
          activeModule.crd38_trainingmoduleid,
      );

      if (!existingProgress) {
        const hasCompleteButton = !!document.getElementById("completeModule");
        const statusToApply = hasCompleteButton
          ? TrainingHub.STATUS.STARTED
          : TrainingHub.STATUS.VIEWED;

        await TrainingHub.updateState(
          statusToApply,
          activeModule.crd38_trainingmoduleid,
        );
      }
    }
  } catch (err) {}
});

document.addEventListener("click", async (e) => {
  const completeButton = e.target.closest("#completeModule");
  if (completeButton && !completeButton.disabled) {
    e.preventDefault();
    const originalText = completeButton.textContent;

    completeButton.disabled = true;
    completeButton.textContent = "Saving...";

    try {
      await TrainingHub.completeAndContinue();
    } catch (err) {
      completeButton.disabled = false;
      completeButton.textContent = originalText;
    }
    return;
  }

  const knowledgeButton = e.target.closest(".knowledge-option");
  if (knowledgeButton && !knowledgeButton.disabled) {
    e.preventDefault();
    TrainingHub.handleKnowledgeCheck(knowledgeButton);
  }
});
