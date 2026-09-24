window.AdminHub = {
  state: {
    summaryStats: {
      totalLearningJourneys: 0,
      totalTrainingModules: 0,
      testimoniesCount: 0,
    },
    learningPaths: [],
    modules: [],
    testimonies: [],
    currentTab: "learningPaths", // "learningPaths" | "testimonies" | "modules"
    selectedJourneyId: null,
  },

  /**
   * Helper: Formats name into standard fallback image path (/first_last_img.jpg)
   */
  _buildFallbackImagePath(fullName = "") {
    console.log(
      "[AdminHub._buildFallbackImagePath] Computing fallback path for:",
      fullName,
    );
    const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      console.warn(
        "[AdminHub._buildFallbackImagePath] Name has fewer than two parts. Returning empty fallback path.",
      );
      return "";
    }
    const path = `/${parts[0]}_${parts[parts.length - 1]}_img.jpg`;
    console.log(
      "[AdminHub._buildFallbackImagePath] Generated fallback path:",
      path,
    );
    return path;
  },

  /**
   * Helper: Resolves image path (custom or auto-generated fallback)
   */
  _getTestimonyImagePath(item = {}) {
    console.log(
      "[AdminHub._getTestimonyImagePath] Resolving photo path for item:",
      item,
    );
    const customData = (
      item?.crd38_imageurl ||
      item?.image?.data ||
      ""
    ).trim();
    if (customData) {
      console.log(
        "[AdminHub._getTestimonyImagePath] Found custom image data/path:",
        customData,
      );
      return customData;
    }
    const fallback = this._buildFallbackImagePath(
      item?.crd38_name || item?.name || "",
    );
    console.log(
      "[AdminHub._getTestimonyImagePath] Using computed fallback path:",
      fallback,
    );
    return fallback;
  },

  /**
   * Helper: Computes initials from a full name
   */
  _getInitials(name = "") {
    console.log("[AdminHub._getInitials] Computing initials for name:", name);
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) return "?";
    if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
    const initials = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    console.log("[AdminHub._getInitials] Computed initials:", initials);
    return initials;
  },

  /**
   * Wrapper to invoke the server-side logic endpoint (GET or POST)
   */
  async _callServer(action = "getAdminOverview", extraParams = "", payload = null) {
    if (action === "getAdminOverview")
      return ConnectHub.cache.get("admin:overview", () =>
        this._requestServer(action, extraParams, payload));
    const result = await this._requestServer(action, extraParams, payload);
    ConnectHub.cache.invalidate("admin:overview");
    ConnectHub.cache.invalidate("training:");
    ConnectHub.cache.invalidate("testimonies");
    return result;
  },

  async _requestServer(
    action = "getAdminOverview",
    extraParams = "",
    payload = null,
  ) {
    const currentPath = window.location.pathname;
    const url = `/_api/serverlogics/AdminHubMaster?action=${action}&currentPath=${encodeURIComponent(currentPath)}${extraParams}`;

    console.log(
      `[AdminHub._callServer] Executing API Call -> Action: ${action} | URL: ${url}`,
      {
        payload,
        currentPath,
      },
    );

    const headers = {
      Accept: "application/json",
      "OData-MaxVersion": "4.0",
      "OData-Version": "4.0",
      __RequestVerificationToken: await ConnectHub.getToken(),
    };

    const options = {
      method: payload ? "POST" : "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers,
    };

    if (payload) {
      headers["Content-Type"] = "application/json";
      options.body = JSON.stringify(payload);
    }

    try {
      const response = await fetch(url, options);
      console.log(
        `[AdminHub._callServer] HTTP Status Code: ${response.status} for action: ${action}`,
      );

      if (!response.ok) {
        throw new Error(
          `Server request failed with status code ${response.status}`,
        );
      }

      const envelope = await response.json();
      console.log(
        `[AdminHub._callServer] Envelope received for [${action}]:`,
        envelope,
      );

      if (envelope.success === false) {
        throw new Error(envelope.message || "Error executing server script.");
      }

      if (!envelope.data) {
        console.warn(
          `[AdminHub._callServer] Envelope data is missing or empty for [${action}].`,
        );
        return envelope;
      }

      // Inside window.AdminHub._callServer:
      const parsedData =
        typeof envelope.data === "string"
          ? JSON.parse(envelope.data)
          : envelope.data;

      if (parsedData?.success === false)
        throw new Error(parsedData.message || "Admin request failed.");

      console.log(
        `[AdminHub._callServer] Successfully parsed payload data for [${action}]:`,
        parsedData,
      );

      return parsedData?.data || parsedData;
    } catch (err) {
      console.error(
        `[AdminHub._callServer] Failed during execution of [${action}]:`,
        err,
      );
      throw err;
    }
  },

  /**
   * Initializes data fetch from Dataverse server-side API
   */
  async init() {
    console.log("[AdminHub.init] Initializing Admin Hub module...");
    try {
      const overviewData = await this._callServer("getAdminOverview");
      console.log("[AdminHub.init] Raw Overview Data retrieved:", overviewData);

      this.state = {
        ...this.state,
        summaryStats: {
          ...overviewData?.summaryStats,
          testimoniesCount: Array.isArray(overviewData?.testimonies)
            ? overviewData.testimonies.length
            : 0,
        },
        learningPaths: Array.isArray(overviewData?.learningPaths)
          ? overviewData.learningPaths
          : [],
        modules: Array.isArray(overviewData?.modules)
          ? overviewData.modules
          : [],
        testimonies: Array.isArray(overviewData?.testimonies)
          ? overviewData.testimonies
          : [],
      };

      console.log("[AdminHub.init] State successfully populated:", this.state);

      this.renderStats();
      this.renderRecentActivity();
      this.setupModalEvents();
      this.setupSidebarEvents();
      this.setupDelegatedEvents(); // CSP-compliant event delegation listener

      console.log("[AdminHub.init] Setup completed successfully.");
    } catch (err) {
      console.error("[AdminHub] Initialization failed:", err);
      const notice = document.createElement("p");
      notice.className = "loading-state";
      notice.setAttribute("role", "alert");
      notice.textContent = "Admin data could not load. Refresh the page or check your site access.";
      document.querySelector(".admin-shell")?.prepend(notice);
    }
  },

  /**
   * CSP Fix: Single delegated event listener on body for rendered actions
   */
  setupDelegatedEvents() {
    console.log(
      "[AdminHub.setupDelegatedEvents] Registering delegated click and error listeners...",
    );
    document.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-action]");
      if (!btn) return;

      const action = btn.getAttribute("data-action");
      const id = btn.getAttribute("data-id");
      const type = btn.getAttribute("data-type");

      console.log("[AdminHub.delegatedClick] Dynamic button clicked:", {
        action,
        id,
        type,
        target: btn,
      });

      switch (action) {
        case "view-modules":
          this.openJourneyModules(id);
          break;
        case "switch-tab":
          this.switchTab(btn.getAttribute("data-tab"));
          break;
        case "edit":
          this.editItem(type, id);
          break;
        case "delete":
          this.deleteItem(type, id);
          break;
        case "close-edit-modal":
          this._closeEditModal();
          break;
        default:
          console.warn(
            "[AdminHub.delegatedClick] Unhandled action attribute:",
            action,
          );
      }
    });

    // Image fallback handling using delegation for dynamic admin cards
    document.body.addEventListener(
      "error",
      (e) => {
        if (e.target && e.target.classList.contains("admin-avatar-img")) {
          const img = e.target;
          console.warn(
            "[AdminHub.imageError] Avatar image failed to load:",
            img.src,
          );
          const parent = img.closest(".admin-avatar-thumb");
          if (parent) {
            const initials = img.getAttribute("data-initials") || "?";
            console.log(
              `[AdminHub.imageError] Replacing image with fallback initials: (${initials})`,
            );
            parent.classList.add("image-failed");
            parent.innerHTML = `<span>${initials}</span>`;
          }
        }
      },
      true, // Capturing phase needed for error event listener delegation
    );
  },

  /**
   * Setup click handling for open buttons and modal closing
   */
  setupModalEvents() {
    console.log(
      "[AdminHub.setupModalEvents] Setting up workspace modal listeners...",
    );
    document.querySelectorAll("[data-modal-type]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const type = e.currentTarget.getAttribute("data-modal-type");
        console.log(
          "[AdminHub.modalEvent] Open modal triggered for type:",
          type,
        );
        this.openModal(type);
      });
    });

    document.querySelectorAll("[data-close-modal]").forEach((el) => {
      el.addEventListener("click", () => {
        console.log("[AdminHub.modalEvent] Close workspace modal triggered.");
        this.closeModal();
      });
    });

    document.addEventListener("keydown", (event) => {
      const edit = document.getElementById("visualEditModal");
      const workspace = document.getElementById("adminModal");
      const openModal = edit?.classList.contains("is-open") ? edit
        : workspace?.classList.contains("is-open") ? workspace : null;
      if (event.key === "Tab" && openModal) {
        const focusable = [...openModal.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled])')];
        const first = focusable[0], last = focusable[focusable.length - 1];
        if (!openModal.contains(document.activeElement)) {
          event.preventDefault(); first?.focus();
        } else if (event.shiftKey && document.activeElement === first) {
          event.preventDefault(); last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault(); first?.focus();
        }
      }
      if (event.key !== "Escape") return;
      if (edit?.classList.contains("is-open"))
        this._closeEditModal();
      else if (workspace?.classList.contains("is-open"))
        this.closeModal();
    });

    document.getElementById("workspaceCreateBtn")?.addEventListener("click", () =>
      this.handleCreateNew());

    const searchInput = document.getElementById("workspaceSearch");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => {
        console.log(
          "[AdminHub.workspaceSearch] Filtering items by query:",
          e.target.value,
        );
        this.filterWorkspaceItems(e.target.value);
      });
    } else {
      console.warn(
        "[AdminHub.setupModalEvents] Search element '#workspaceSearch' not found in DOM.",
      );
    }
  },

  /**
   * Setup sidebar tab navigation listeners
   */
  setupSidebarEvents() {
    console.log(
      "[AdminHub.setupSidebarEvents] Attaching sidebar navigation listeners...",
    );
    document.querySelectorAll(".admin-sidebar [data-nav]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const tab = e.currentTarget.getAttribute("data-nav");
        console.log("[AdminHub.sidebarNavigation] Navigating to tab:", tab);
        this.switchTab(tab);
      });
    });

    const createBtn = document.getElementById("sidebarActionCreate");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        console.log("[AdminHub.sidebarAction] 'Create New' clicked.");
        this.handleCreateNew();
      });
    } else {
      console.warn(
        "[AdminHub.setupSidebarEvents] Create button '#sidebarActionCreate' not found.",
      );
    }
  },

  switchTab(tab) {
    console.log(
      `[AdminHub.switchTab] Switching active workspace tab to: [${tab}]`,
    );
    this.state.currentTab = tab;
    if (tab !== "modules") {
      console.log(
        "[AdminHub.switchTab] Resetting selectedJourneyId state to null.",
      );
      this.state.selectedJourneyId = null;
    }

    document.querySelectorAll(".admin-sidebar [data-nav]").forEach((btn) => {
      if (btn.getAttribute("data-nav") === tab) {
        btn.classList.add("active");
      } else {
        btn.classList.remove("active");
      }
    });

    this.renderCurrentWorkspaceView();
  },

  /**
   * Modal management renderer
   */
  openModal(type = "learningPaths") {
    console.log("[AdminHub.openModal] Opening workspace modal for type:", type);
    const modal = document.getElementById("adminModal");
    if (!modal) {
      console.error(
        "[AdminHub.openModal] Workspace modal '#adminModal' not found.",
      );
      return;
    }

    this._workspacePreviousFocus = document.activeElement;
    this.switchTab(type);

    modal.classList.add("is-open");
    modal.setAttribute("aria-hidden", "false");
    modal.querySelector("#workspaceSearch")?.focus();
  },

  closeModal() {
    console.log("[AdminHub.closeModal] Closing workspace modal.");
    const modal = document.getElementById("adminModal");
    if (!modal) return;
    modal.classList.remove("is-open");
    modal.setAttribute("aria-hidden", "true");
    this._workspacePreviousFocus?.focus?.();
  },

  renderCurrentWorkspaceView() {
    console.log(
      `[AdminHub.renderCurrentWorkspaceView] Rendering view for tab: [${this.state.currentTab}]`,
    );
    const titleEl = document.getElementById("modalTitle");
    const subtitleEl = document.getElementById("modalSubtitle");
    const badgeEl = document.getElementById("workspaceType");
    const bodyEl = document.getElementById("modalBody");
    const totalCountEl = document.getElementById("workspaceTotalCount");

    if (!bodyEl) {
      console.error(
        "[AdminHub.renderCurrentWorkspaceView] '#modalBody' element is missing.",
      );
      return;
    }

    if (this.state.currentTab === "learningPaths") {
      if (titleEl) titleEl.textContent = "Learning Journeys";
      if (subtitleEl)
        subtitleEl.textContent =
          "Select a journey to view and manage its training modules.";
      if (badgeEl) badgeEl.textContent = "Learning Management";
      if (totalCountEl)
        totalCountEl.textContent = this.state.learningPaths.length;

      bodyEl.innerHTML = this._renderPathsTable();
    } else if (this.state.currentTab === "modules") {
      const journey = this.state.learningPaths.find(
        (lp) =>
          (lp.crd38_learningpathid || lp.id) === this.state.selectedJourneyId,
      );
      const journeyName = journey
        ? journey.crd38_name || "Journey"
        : "All Journeys";
      const filteredModules = this._getModulesForSelectedJourney();

      console.log(
        "[AdminHub.renderCurrentWorkspaceView] Selected Journey for modules view:",
        {
          selectedJourneyId: this.state.selectedJourneyId,
          journeyName,
          totalFilteredModules: filteredModules.length,
        },
      );

      if (titleEl) titleEl.textContent = `${journeyName} — Modules`;
      if (subtitleEl)
        subtitleEl.textContent = `Managing training modules under "${journeyName}".`;
      if (badgeEl) badgeEl.textContent = "Module Management";
      if (totalCountEl) totalCountEl.textContent = filteredModules.length;

      bodyEl.innerHTML = this._renderModulesTable(filteredModules, journeyName);
    } else if (this.state.currentTab === "testimonies") {
      if (titleEl) titleEl.textContent = "Manage AI Testimonies";
      if (subtitleEl)
        subtitleEl.textContent =
          "Review and edit social proof and user feedback.";
      if (badgeEl) badgeEl.textContent = "Content Management";
      if (totalCountEl)
        totalCountEl.textContent = this.state.testimonies.length;

      bodyEl.innerHTML = this._renderTestimoniesTable();
    }
  },

  _getModulesForSelectedJourney() {
    console.log(
      "[AdminHub._getModulesForSelectedJourney] Filtering modules for target journey ID:",
      this.state.selectedJourneyId,
    );
    if (!this.state.selectedJourneyId) return this.state.modules;
    const filtered = this.state.modules.filter(
      (m) =>
        m._crd38_learningpathref_value === this.state.selectedJourneyId ||
        m.crd38_learningpathid === this.state.selectedJourneyId ||
        m.learningPathId === this.state.selectedJourneyId,
    );
    console.log(
      "[AdminHub._getModulesForSelectedJourney] Filtered result set count:",
      filtered.length,
    );
    return filtered;
  },

  openJourneyModules(journeyId) {
    console.log(
      "[AdminHub.openJourneyModules] Opening modules for journey ID:",
      journeyId,
    );
    this.state.selectedJourneyId = journeyId;
    this.state.currentTab = "modules";
    this.renderCurrentWorkspaceView();
  },

  filterWorkspaceItems(query) {
    const q = query.toLowerCase().trim();
    console.log(
      "[AdminHub.filterWorkspaceItems] Searching workspace cards for matching query string:",
      q,
    );
    const cards = document.querySelectorAll("#modalBody .admin-object-card");

    let visibleCount = 0;
    cards.forEach((card) => {
      const text = card.textContent.toLowerCase();
      if (!q || text.includes(q)) {
        card.style.display = "";
        visibleCount++;
      } else {
        card.style.display = "none";
      }
    });

    console.log(
      `[AdminHub.filterWorkspaceItems] Search complete. Showing ${visibleCount}/${cards.length} cards.`,
    );
  },

  /* Card Grid Generators */

  _renderPathsTable() {
    console.log(
      "[AdminHub._renderPathsTable] Generating HTML cards for Learning Paths. Count:",
      this.state.learningPaths.length,
    );
    if (!this.state.learningPaths.length) {
      return `<div class="empty-state"><p>No learning journeys found.</p></div>`;
    }

    return this.state.learningPaths
      .map((lp) => {
        const id = lp.crd38_learningpathid || lp.id || "";
        const moduleCount = this.state.modules.filter(
          (m) =>
            m._crd38_learningpathref_value === id ||
            m.crd38_learningpathid === id ||
            m.learningPathId === id,
        ).length;

        return `
        <article class="admin-object-card" data-id="${id}">
          <div class="admin-object-top">
            <span class="admin-object-type green">
              <i class="fi fi-rr-route"></i>
              Learning Journey
            </span>
            <button class="admin-object-menu-btn" aria-label="Options">
              <i class="fi fi-rr-menu-dots"></i>
            </button>
          </div>

          <div class="admin-object-content">
            <h3>${this._escapeHtml(lp.crd38_name || "Untitled")}</h3>
            <p>${this._escapeHtml(lp.crd38_description || "No description provided.")}</p>
          </div>

          <div class="admin-object-meta">
            <span>
              <i class="fi fi-rr-sort"></i>
              Order: ${lp.crd38_displayorder ?? "-"}
            </span>
            <span>
              <i class="fi fi-rr-book-alt"></i>
              ${moduleCount} Modules
            </span>
          </div>

          <div class="admin-object-actions">
            <button class="object-btn view-modules" data-action="view-modules" data-id="${id}">
              <i class="fi fi-rr-eye"></i> View Modules
            </button>
            <button class="object-btn edit" data-action="edit" data-type="learningPath" data-id="${id}">
              <i class="fi fi-rr-pencil"></i> Edit
            </button>
            <button class="object-btn delete" data-action="delete" data-type="learningPath" data-id="${id}">
              <i class="fi fi-rr-trash"></i> Delete
            </button>
          </div>
        </article>
      `;
      })
      .join("");
  },

  _renderModulesTable(modulesList = [], journeyName = "") {
    console.log(
      `[AdminHub._renderModulesTable] Generating HTML cards for modules under '${journeyName}'. Count:`,
      modulesList.length,
    );
    const backBar = `
      <div class="workspace-back-bar">
        <button class="object-btn" data-action="switch-tab" data-tab="learningPaths">
          <i class="fi fi-rr-arrow-left"></i> Back to Journeys
        </button>
      </div>
    `;

    if (!modulesList.length) {
      return `${backBar}<div class="empty-state full-width"><p>No modules found for ${this._escapeHtml(journeyName)}.</p></div>`;
    }

    return (
      backBar +
      modulesList
        .map((m) => {
          const moduleId =
            m.crd38_trainingmoduleid || m.id || "";
          return `
        <article class="admin-object-card" data-id="${moduleId}">
          <div class="admin-object-top">
            <span class="admin-object-type cyan">
              <i class="fi fi-rr-e-learning"></i>
              Module
            </span>
            <button class="admin-object-menu-btn" aria-label="Options">
              <i class="fi fi-rr-menu-dots"></i>
            </button>
          </div>

          <div class="admin-object-content">
            <h3>${this._escapeHtml(m.crd38_name || "Untitled Module")}</h3>
            <p>${this._escapeHtml(m.crd38_description || "No description available.")}</p>
          </div>

          <div class="admin-object-tags">
            ${
              m.crd38_required
                ? '<span class="admin-tag required">Required</span>'
                : '<span class="admin-tag">Optional</span>'
            }
            <span class="admin-tag">Order ${m.crd38_displayorder ?? "-"}</span>
          </div>

          <div class="admin-object-actions">
            <button class="object-btn edit" data-action="edit" data-type="module" data-id="${moduleId}">
              <i class="fi fi-rr-pencil"></i> Edit
            </button>
            <button class="object-btn delete" data-action="delete" data-type="module" data-id="${moduleId}">
              <i class="fi fi-rr-trash"></i> Delete
            </button>
          </div>
        </article>
      `;
        })
        .join("")
    );
  },

  _renderTestimoniesTable() {
    console.log(
      "[AdminHub._renderTestimoniesTable] Generating HTML cards for AI Testimonies. Count:",
      this.state.testimonies.length,
    );
    if (!this.state.testimonies.length) {
      return `<div class="empty-state"><p>No testimonies found.</p></div>`;
    }

    return this.state.testimonies
      .map((item) => {
        const id = item.crd38_aitestimonyid || item.id || "";
        const name = item.crd38_name || item.name || "Anonymous";
        const quote = item.crd38_quote || item.quote || "";
        const initials = this._getInitials(name);
        const imgPath = this._getTestimonyImagePath(item);

        const avatarMarkup = imgPath
          ? `<div class="admin-avatar-thumb">
               <img src="${this._escapeHtml(imgPath)}" alt="${this._escapeHtml(name)}" class="admin-avatar-img" data-initials="${initials}" />
             </div>`
          : `<div class="admin-avatar-thumb image-failed">
               <span>${initials}</span>
             </div>`;

        const tagsList =
          typeof item.crd38_tags === "string"
            ? item.crd38_tags.split(",").map((t) => t.trim())
            : Array.isArray(item.tags)
              ? item.tags
              : [];

        return `
        <article class="admin-object-card testimony-card" data-id="${this._escapeHtml(id)}">
          <div class="admin-object-top">
            <span class="admin-object-type purple">
              <i class="fi fi-rr-quote-right"></i>
              AI Testimony
            </span>
          </div>

          <div class="admin-testimony-header">
            ${avatarMarkup}
            <div>
              <h3>${this._escapeHtml(name)}</h3>
              <span class="admin-photo-path-badge">${this._escapeHtml(imgPath)}</span>
            </div>
          </div>

          <div class="admin-object-content">
            <blockquote>"${this._escapeHtml(quote)}"</blockquote>
          </div>

          <div class="admin-object-tags">
            ${tagsList
              .map(
                (tag) =>
                  `<span class="admin-tag">${this._escapeHtml(tag)}</span>`,
              )
              .join("")}
          </div>

          <div class="admin-object-actions">
            <button class="object-btn edit" data-action="edit" data-type="testimony" data-id="${this._escapeHtml(id)}">
              <i class="fi fi-rr-pencil"></i> Edit
            </button>
            <button class="object-btn delete" data-action="delete" data-type="testimony" data-id="${this._escapeHtml(id)}">
              <i class="fi fi-rr-trash"></i> Delete
            </button>
          </div>
        </article>
      `;
      })
      .join("");
  },

  renderStats() {
    console.log(
      "[AdminHub.renderStats] Rendering summary statistics elements...",
      this.state.summaryStats,
    );
    const { summaryStats } = this.state;
    if (!summaryStats) {
      console.warn("[AdminHub.renderStats] summaryStats is undefined.");
      return;
    }

    const statCards = document.querySelectorAll(".dashboard-stats .stat-card");

    statCards.forEach((card) => {
      const label = card
        .querySelector(".stat-label")
        ?.textContent?.trim()
        .toLowerCase();
      const numberEl = card.querySelector(".stat-number");

      if (!numberEl || !label) return;

      if (label.includes("learning journey")) {
        numberEl.textContent = summaryStats.totalLearningJourneys ?? 0;
      } else if (label.includes("training module")) {
        numberEl.textContent = summaryStats.totalTrainingModules ?? 0;
      } else if (label.includes("testimonies") || label.includes("testimony")) {
        numberEl.textContent = summaryStats.testimoniesCount ?? 0;
      }
    });
  },

  renderRecentActivity() {
    console.log(
      "[AdminHub.renderRecentActivity] Generating recent activity feed...",
    );
    const container = document.getElementById("recentActivity");
    if (!container) {
      console.warn(
        "[AdminHub.renderRecentActivity] Recent activity container '#recentActivity' not found.",
      );
      return;
    }

    const learningPaths = this.state.learningPaths || [];
    const modules = this.state.modules || [];

    const allItems = [
      ...learningPaths.map((lp) => ({
        title: "Learning Journey",
        subtitle: lp.crd38_name || "Untitled Journey",
        date: lp.createdon ? new Date(lp.createdon) : new Date(),
      })),
      ...modules.map((m) => ({
        title: "Training Module",
        subtitle: m.crd38_name || "Untitled Module",
        date: m.createdon ? new Date(m.createdon) : new Date(),
      })),
    ];

    allItems.sort((a, b) => b.date - a.date);
    const recent = allItems.slice(0, 5);

    console.log(
      "[AdminHub.renderRecentActivity] Sorted recent items count:",
      recent.length,
    );
    if (recent.length === 0) return;

    container.innerHTML = recent
      .map(
        (item) => `
        <div class="learning-item">
          <div>
            <div class="learning-item-title">${item.title}</div>
            <div class="learning-item-subtitle">${this._escapeHtml(item.subtitle)}</div>
          </div>
          <div class="learning-item-status">${this._formatRelativeDate(item.date)}</div>
        </div>
      `,
      )
      .join("");
  },

  _formatRelativeDate(date) {
    const now = new Date();
    const diffTime = Math.abs(now - date);
    const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return "Today";
    if (diffDays === 1) return "Yesterday";
    return `${diffDays} days ago`;
  },

  _escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  /* Visual Actions */

  handleCreateNew() {
    const type = {
      learningPaths: "learningPath",
      modules: "module",
      testimonies: "testimony",
    }[this.state.currentTab];
    if (type) this._showEditModal(type, {}, null);
  },

  editItem(type, id) {
    console.log(
      `[AdminHub.editItem] Initiating edit for type [${type}] with ID [${id}]`,
    );
    let itemData = null;

    if (type === "learningPath") {
      itemData = this.state.learningPaths.find(
        (p) => (p.crd38_learningpathid || p.id) === id,
      );
    } else if (type === "module") {
      itemData = this.state.modules.find(
        (m) => (m.crd38_trainingmoduleid || m.id) === id,
      );
    } else if (type === "testimony") {
      itemData = this.state.testimonies.find(
        (t) => (t.crd38_aitestimonyid || t.id) === id,
      );
    }

    console.log("[AdminHub.editItem] Target item data matched:", itemData);
    this._showEditModal(type, itemData || {}, id);
  },

  async deleteItem(type, id) {
    console.log(
      `[AdminHub.deleteItem] Delete requested for type [${type}] with ID [${id}]`,
    );
    const confirmDelete = confirm(
      `Are you sure you want to delete this ${type}?`,
    );
    if (!confirmDelete) {
      console.log(
        "[AdminHub.deleteItem] User cancelled deletion confirmation.",
      );
      return;
    }

    try {
      const deletePayload = {
        entityType: type,
        id: id,
      };

      console.log(
        "[AdminHub.deleteItem] Sending server request to delete record:",
        deletePayload,
      );
      await this._callServer("deleteData", "", deletePayload);

      console.log(
        "[AdminHub.deleteItem] Record deleted successfully. Fetching refreshed overview data...",
      );
      const freshData = await this._callServer("getAdminOverview");

      this.state.learningPaths = freshData.learningPaths || [];
      this.state.modules = freshData.modules || [];
      this.state.testimonies = freshData.testimonies || [];

      if (freshData.summaryStats) {
        this.state.summaryStats = {
          ...freshData.summaryStats,
          testimoniesCount: this.state.testimonies.length,
        };
      }

      console.log(
        "[AdminHub.deleteItem] State re-synchronized following deletion:",
        this.state,
      );

      this.renderStats();
      this.renderCurrentWorkspaceView();
    } catch (err) {
      console.error("[AdminHub.deleteItem] Delete process failed:", err);
      alert("Failed to delete record: " + err.message);
    }
  },

  _showEditModal(type, item, recordId) {
    this._previousFocus = document.activeElement;
    const typeLabel = { learningPath: "learning journey", module: "training module", testimony: "AI testimony" }[type] || type;
    console.log(
      `[AdminHub._showEditModal] Rendering Edit Modal for entity: ${type}, ID: ${recordId}`,
    );
    let modalOverlay = document.getElementById("visualEditModal");

    if (!modalOverlay) {
      console.log(
        "[AdminHub._showEditModal] Modal overlay missing from DOM. Injecting new '#visualEditModal' element.",
      );
      modalOverlay = document.createElement("div");
      modalOverlay.id = "visualEditModal";
      modalOverlay.className = "edit-modal-overlay";
      document.body.appendChild(modalOverlay);
    }
    modalOverlay.setAttribute("role", "dialog");
    modalOverlay.setAttribute("aria-modal", "true");
    modalOverlay.setAttribute("aria-labelledby", "editModalTitle");

    let formFields = "";
    const displayOrder =
      item.crd38_displayorder ?? item.displayOrder ?? item.order ?? 0;

    if (type === "testimony") {
      const name = item.crd38_name || item.name || "";
      const quote = item.crd38_quote || item.quote || "";
      const paragraph = item.crd38_paragraphs || item.paragraph || "";
      const tags =
        item.crd38_tags ||
        (Array.isArray(item.tags) ? item.tags.join(", ") : "");
      const photoPath = item.crd38_imageurl || item.image?.data || "";
      const computedPath = this._getTestimonyImagePath(item);

      formFields = `
        <div class="edit-form-group">
          <label for="editName" class="edit-form-label">Name:</label>
          <input type="text" id="editName" class="edit-form-input" value="${this._escapeHtml(name)}" />
        </div>

        <div class="edit-form-group">
          <label for="editImageData" class="edit-form-label">Photo Data / Image URL:</label>
          <input type="text" id="editImageData" class="edit-form-input" placeholder="e.g. /john_smith.jpg (Leave empty for fallback path)" value="${this._escapeHtml(photoPath)}" />
          <small class="edit-form-help">Computed Path: <code id="editComputedPath">${this._escapeHtml(computedPath)}</code></small>
        </div>

        <div class="edit-form-group">
          <label class="edit-form-label">Live Photo Preview:</label>
          <div class="modal-photo-preview-box">
            <div class="admin-avatar-thumb">
              <img src="${this._escapeHtml(computedPath)}" id="editPhotoPreviewImg" alt="Preview" class="admin-avatar-img" data-initials="${this._getInitials(name)}" />
            </div>
            <span class="preview-text">Displays in carousel avatars</span>
          </div>
        </div>

        <div class="edit-form-group">
          <label for="editQuote" class="edit-form-label">Quote:</label>
          <textarea id="editQuote" class="edit-form-textarea short">${this._escapeHtml(quote)}</textarea>
        </div>

        <div class="edit-form-group">
          <label for="editParagraphs" class="edit-form-label">Main Paragraph Content:</label>
          <textarea id="editParagraphs" class="edit-form-textarea tall">${this._escapeHtml(paragraph)}</textarea>
        </div>

        <div class="edit-form-group">
          <label for="editTags" class="edit-form-label">Tags (comma-separated):</label>
          <input type="text" id="editTags" class="edit-form-input" value="${this._escapeHtml(tags)}" />
        </div>
      `;
    } else {
      const title = item.crd38_name || "";
      const description = item.crd38_description || "";

      formFields = `
        <div class="edit-form-group">
          <label for="editTitle" class="edit-form-label">Title / Name:</label>
          <input type="text" id="editTitle" class="edit-form-input" value="${this._escapeHtml(title)}" />
        </div>

        <div class="edit-form-group">
          <label for="editDisplayOrder" class="edit-form-label">Display Order:</label>
          <input type="number" id="editDisplayOrder" class="edit-form-input" value="${displayOrder}" />
        </div>

        <div class="edit-form-group">
          <label for="editDescription" class="edit-form-label">Description:</label>
          <textarea id="editDescription" class="edit-form-textarea medium">${this._escapeHtml(description)}</textarea>
        </div>
      `;
      if (type === "learningPath") {
        formFields += `
          <div class="edit-form-group">
            <label for="editRoleRequirement" class="edit-form-label">Job title rule</label>
            <input id="editRoleRequirement" class="edit-form-input" value="${this._escapeHtml(item.crd38_rolerequirement || "")}" />
            <small class="edit-form-help">Leave blank for everyone. Separate job title terms with commas; prefix exclusions with !.</small>
          </div>`;
      } else if (type === "module") {
        const selected = item._crd38_learningpathref_value || this.state.selectedJourneyId || "";
        formFields += `
          <div class="edit-form-group">
            <label for="editLearningPath" class="edit-form-label">Learning journey</label>
            <select id="editLearningPath" class="edit-form-input" required>
              <option value="">Select a journey</option>
              ${this.state.learningPaths.map(path => {
                const id = path.crd38_learningpathid;
                return `<option value="${this._escapeHtml(id)}" ${id === selected ? "selected" : ""}>${this._escapeHtml(path.crd38_name || "Untitled journey")}</option>`;
              }).join("")}
            </select>
          </div>
          <div class="edit-form-group">
            <label for="editPageUrl" class="edit-form-label">Page URL</label>
            <input id="editPageUrl" class="edit-form-input" value="${this._escapeHtml(item.crd38_pageurl || "")}" placeholder="/training/module" required />
          </div>
          <div class="edit-form-group">
            <label for="editRequired" class="edit-form-label">Required module</label>
            <input id="editRequired" type="checkbox" ${item.crd38_required ? "checked" : ""} />
          </div>`;
      }
    }

    modalOverlay.innerHTML = `
      <div class="edit-modal-card">
        <h2 id="editModalTitle" class="edit-modal-title">${recordId ? "Edit" : "Create"} ${typeLabel}</h2>
        <form id="editForm">
          ${formFields}
          <div class="edit-modal-actions">
            <button type="button" class="edit-modal-btn cancel" data-action="close-edit-modal">Cancel</button>
            <button type="submit" class="edit-modal-btn save" id="saveEditBtn">${recordId ? "Save changes" : "Create"}</button>
          </div>
        </form>
      </div>
    `;

    modalOverlay.classList.add("is-open");
    modalOverlay.querySelector("input, textarea, select")?.focus();

    // Dynamic reactive preview when updating image inputs
    const imageInput = document.getElementById("editImageData");
    const nameInput = document.getElementById("editName");
    const previewImgContainer = modalOverlay.querySelector(
      ".modal-photo-preview-box",
    );

    const updatePreview = () => {
      console.log(
        "[AdminHub._showEditModal] Live reactive preview input updated.",
      );
      if (!previewImgContainer) return;
      const currentVal = imageInput ? imageInput.value.trim() : "";
      const currentName = nameInput ? nameInput.value.trim() : "";
      const newPath = currentVal || this._buildFallbackImagePath(currentName);
      const initials = this._getInitials(currentName);

      console.log(
        "[AdminHub._showEditModal] Computing reactive avatar image values:",
        {
          currentVal,
          currentName,
          newPath,
          initials,
        },
      );

      const computedPathEl = document.getElementById("editComputedPath");
      if (computedPathEl) computedPathEl.textContent = newPath;

      const avatarThumb = previewImgContainer.querySelector(
        ".admin-avatar-thumb",
      );
      if (avatarThumb) {
        avatarThumb.classList.remove("image-failed");
        avatarThumb.innerHTML = `<img src="${this._escapeHtml(newPath)}" id="editPhotoPreviewImg" alt="Preview" class="admin-avatar-img" data-initials="${initials}" />`;
      }
    };

    if (imageInput) imageInput.addEventListener("input", updatePreview);
    if (nameInput) nameInput.addEventListener("input", updatePreview);

    const form = document.getElementById("editForm");
    if (form) {
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        console.log(
          `[AdminHub._showEditModal] Submitting form updates for entity type [${type}] with ID [${recordId}]`,
        );

        const saveBtn = document.getElementById("saveEditBtn");
        if (saveBtn) {
          saveBtn.disabled = true;
          saveBtn.textContent = "Saving...";
        }

        try {
          let payloadData = {};

          if (type === "testimony") {
            payloadData = {
              name: document.getElementById("editName")?.value || "",
              photopath: document.getElementById("editImageData")?.value || "",
              quote: document.getElementById("editQuote")?.value || "",
              paragraph: document.getElementById("editParagraphs")?.value || "",
              tags: document.getElementById("editTags")?.value || "",
            };
          } else {
            payloadData = {
              name: document.getElementById("editTitle")?.value || "",
              displayOrder:
                document.getElementById("editDisplayOrder")?.value || 0,
              description:
                document.getElementById("editDescription")?.value || "",
            };
            if (type === "learningPath")
              payloadData.roleRequirement = document.getElementById("editRoleRequirement")?.value || "";
            if (type === "module") {
              payloadData.learningPathId = document.getElementById("editLearningPath")?.value || "";
              payloadData.pageUrl = document.getElementById("editPageUrl")?.value || "";
              payloadData.required = document.getElementById("editRequired")?.checked === true;
            }
          }

          const updatePayload = {
            entityType: type,
            id: recordId,
            data: payloadData,
          };

          console.log(
            "[AdminHub._showEditModal] Submitting update payload to server:",
            updatePayload,
          );
          await this._callServer(recordId ? "updateData" : "createData", "", updatePayload);

          this._closeEditModal();

          // Refresh dashboard data post update
          console.log(
            "[AdminHub._showEditModal] Update successful. Re-fetching dashboard data...",
          );
          const freshData = await this._callServer("getAdminOverview");
          this.state.learningPaths = freshData.learningPaths || [];
          this.state.modules = freshData.modules || [];
          this.state.testimonies = freshData.testimonies || [];
          if (freshData.summaryStats) this.state.summaryStats = {
            ...freshData.summaryStats,
            testimoniesCount: this.state.testimonies.length,
          };

          this.renderStats();
          this.renderCurrentWorkspaceView();
        } catch (err) {
          console.error(
            "[AdminHub._showEditModal] Failed to save updates:",
            err,
          );
          alert("Error saving record changes: " + err.message);
        } finally {
          if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = recordId ? "Save changes" : "Create";
          }
        }
      });
    }
  },

  _closeEditModal() {
    console.log("[AdminHub._closeEditModal] Closing edit modal overlay.");
    const modalOverlay = document.getElementById("visualEditModal");
    if (modalOverlay) {
      modalOverlay.classList.remove("is-open");
    }
    this._previousFocus?.focus?.();
  },
};

window.addEventListener("DOMContentLoaded", () => {
  console.log(
    "[AdminHub] DOMContentLoaded event triggered. Starting AdminHub application...",
  );
  AdminHub.init();
});
