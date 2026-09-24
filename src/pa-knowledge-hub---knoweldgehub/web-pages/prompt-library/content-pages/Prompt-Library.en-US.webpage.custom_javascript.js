document.addEventListener("DOMContentLoaded", () => {
  initialiseSearchAndFilter();
  initialisePromptGenerator();
  initialiseCopyButtons();
  initialiseQuickActions();
  updatePromptCount();
});

/* ==========================================
   SEARCH & CATEGORY FILTERING
   ========================================== */

function initialiseSearchAndFilter() {
  const search = document.getElementById("promptSearch");
  const collapsibleWrapper = document.getElementById("collapsibleWrapper");
  const hero = document.querySelector(".training-hero");
  const grid = document.querySelector(".prompt-library-grid");
  const cards = document.querySelectorAll(".prompt-card");
  const filterButtons = document.querySelectorAll(".filter-btn");

  let activeCategory = "all";

  // Helper to handle Hero section collapse state
  const toggleCollapse = (forceCollapse) => {
    const isSearching =
      forceCollapse ||
      Boolean(search?.value.trim()) ||
      activeCategory !== "all";
    collapsibleWrapper?.classList.toggle("is-collapsed", isSearching);
    hero?.classList.toggle("is-searching", isSearching);
  };

  // Main filter function handling BOTH text query & category filter
  const filterPrompts = () => {
    const query = search ? search.value.trim().toLowerCase() : "";
    let visibleCount = 0;

    toggleCollapse(Boolean(query) || activeCategory !== "all");

    cards.forEach((card) => {
      const text = card.innerText.toLowerCase();
      const keywords = (card.dataset.keywords || "").toLowerCase();
      const category = (card.dataset.category || "").toLowerCase();

      // Check text search match
      const matchesSearch =
        !query || text.includes(query) || keywords.includes(query);

      // Check category match
      const matchesCategory =
        activeCategory === "all" || category === activeCategory.toLowerCase();

      const show = matchesSearch && matchesCategory;

      card.style.display = show ? "" : "none";
      card.classList.toggle("prompt-highlight", show && Boolean(query));

      if (show) visibleCount++;
    });

    // Empty state message handling
    let noResultsMsg = document.getElementById("noPromptResults");
    if (visibleCount === 0 && (query || activeCategory !== "all")) {
      if (!noResultsMsg && grid) {
        noResultsMsg = document.createElement("p");
        noResultsMsg.id = "noPromptResults";
        noResultsMsg.className = "no-results-message";
        noResultsMsg.textContent = "No prompts found matching your selection.";
        noResultsMsg.style.cssText =
          "grid-column: 1 / -1; text-align: center; color: var(--muted, #666); padding: 40px 0;";
        grid.appendChild(noResultsMsg);
      }
    } else {
      noResultsMsg?.remove();
    }

    updatePromptCount(visibleCount);
  };

  // Attach search input listeners
  if (search) {
    search.addEventListener("focus", () => toggleCollapse(true));
    search.addEventListener("blur", () => {
      if (!search.value.trim() && activeCategory === "all") {
        toggleCollapse(false);
      }
    });
    search.addEventListener("input", filterPrompts);
  }

  // Attach category button listeners
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      filterButtons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");

      activeCategory = button.getAttribute("data-category") || "all";
      filterPrompts();
    });
  });
}

/* ==========================================
   PROMPT GENERATOR
   ========================================== */

function initialisePromptGenerator() {
  const task = document.getElementById("builderTask");
  const audience = document.getElementById("builderAudience");
  const tone = document.getElementById("builderTone");
  const output = document.getElementById("generatedPrompt");

  if (!task || !audience || !tone || !output) return;

  const updatePrompt = () => {
    output.textContent = `Act as an experienced professional. ${task.value} for ${audience.value}. Use a ${tone.value.toLowerCase()} tone. Ensure the response is clear, well structured and includes any relevant actions, recommendations or next steps.`;
  };

  [task, audience, tone].forEach((el) =>
    el.addEventListener("change", updatePrompt),
  );
  updatePrompt();
}

/* ==========================================
   COPY BUTTONS
   ========================================== */

function initialiseCopyButtons() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".copy-prompt-btn");
    const card = button?.closest(".prompt-card");
    const prompt = card?.querySelector(".prompt-example");

    if (!button || !prompt) return;

    try {
      await navigator.clipboard.writeText(prompt.innerText.trim());

      const originalText = button.textContent;
      button.textContent = "Copied";
      button.classList.add("copy-success");

      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove("copy-success");
      }, 2000);
    } catch (error) {
      console.error("Clipboard copy failed:", error);
    }
  });
}

/* ==========================================
   QUICK ACTIONS
   ========================================== */

function initialiseQuickActions() {
  const mappings = {
    "write an email": "email",
    "summarise a meeting": "meeting",
    "create a report": "report",
    "create a powerpoint": "powerpoint",
    "customer communication": "customer",
    "identify automation opportunities": "planning",
  };

  document.querySelectorAll(".prompt-shortcut").forEach((button) => {
    button.addEventListener("click", () => {
      const search = document.getElementById("promptSearch");
      if (!search) return;

      const buttonText = button.textContent.trim().toLowerCase();
      search.value = mappings[buttonText] || buttonText;
      search.dispatchEvent(new Event("input"));
      search.focus();

      const firstVisible = document.querySelector(
        '.prompt-card:not([style*="display: none"])',
      );
      if (firstVisible) {
        firstVisible.scrollIntoView({ behavior: "smooth", block: "center" });
        firstVisible.classList.add("prompt-focus");
        setTimeout(() => firstVisible.classList.remove("prompt-focus"), 2500);
      }
    });
  });
}

/* ==========================================
   PROMPT COUNT
   ========================================== */

function updatePromptCount(count = null) {
  const element = document.querySelector(".prompt-count");
  if (!element) return;

  const total = count ?? document.querySelectorAll(".prompt-card").length;
  element.textContent = `${total} Prompt${total !== 1 ? "s" : ""}`;
}
