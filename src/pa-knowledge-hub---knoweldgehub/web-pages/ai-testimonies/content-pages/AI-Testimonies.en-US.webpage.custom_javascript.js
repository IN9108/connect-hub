document.addEventListener("DOMContentLoaded", async () => {
  let stories = [];

  try {
    stories = await ConnectHub.cache.get("testimonies", async () => {
      try {
        const result = await TrainingHub._callServer("testimonies");
        if (Array.isArray(result.data) && result.data.length)
          return result.data.map((item) => ({
            name: item.crd38_name || "",
            quote: item.crd38_quote || "",
            paragraphs: String(item.crd38_paragraph || "").split(/\n\s*\n/).filter(Boolean),
            tags: String(item.crd38_tags || "").split(",").map((tag) => tag.trim()).filter(Boolean),
            image: { data: item.crd38_photopath || "" },
          }));
      } catch (error) {
        console.warn("Live testimonies are unavailable; using published stories.", error);
      }
      const response = await fetch("/ai-testimonies.json", { cache: "no-store" });
      if (!response.ok) throw new Error(`Failed to load testimonies: ${response.status}`);
      return response.json();
    });
    if (!Array.isArray(stories)) throw new Error("Testimonies must contain an array.");
  } catch (error) {
    console.error("Unable to load AI testimonies:", error);
    return;
  }

  function getInitials(name = "") {
    const parts = name.trim().split(/\s+/).filter(Boolean);

    if (parts.length === 0) {
      return "?";
    }

    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase();
    }

    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }

  function buildFallbackImagePath(fullName = "") {
    const parts = fullName.trim().toLowerCase().split(/\s+/).filter(Boolean);

    if (parts.length < 2) {
      return "";
    }

    const firstName = parts[0];
    const lastName = parts[parts.length - 1];

    return `/${firstName}_${lastName}_img.jpg`;
  }

  function getStoryImage(story) {
    const imageData = story?.image?.data?.trim?.() || "";

    if (imageData) {
      return imageData;
    }

    return buildFallbackImagePath(story?.name || "");
  }

  function setupImageErrorHandling(imgElement, initials) {
    imgElement.addEventListener("error", function handleError() {
      const iconContainer = imgElement.closest(".person-icon");

      if (iconContainer) {
        iconContainer.classList.add("image-failed");

        const span = document.createElement("span");
        span.textContent = initials;

        iconContainer.appendChild(span);
      }

      imgElement.remove();
    });
  }

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  const shuffledStories = shuffle([...stories]);

  const track = document.getElementById("storiesTrack");
  const carousel = document.querySelector(".stories-carousel");
  const storyHeader = document.querySelector(".story-rail-header");
  const tagsWrapper = document.getElementById("floatingTagsWrapper");

  if (!track) return;

  const colorPattern = ["green", "dark", ""];

  shuffledStories.forEach((item, index) => {
    const article = document.createElement("article");
    const colorClass = colorPattern[index % colorPattern.length];
    article.className = `story-panel ${colorClass}`.trim();

    const initials = getInitials(item.name || "");
    const imagePath = getStoryImage(item);

    const personIcon = document.createElement("div");
    personIcon.className = "person-icon";

    if (imagePath) {
      const img = document.createElement("img");
      img.src = imagePath;
      img.alt = item.name || initials;

      setupImageErrorHandling(img, initials);
      personIcon.appendChild(img);
    } else {
      personIcon.classList.add("image-failed");
      const span = document.createElement("span");
      span.textContent = initials;
      personIcon.appendChild(span);
    }

    const tagSpans = (item.tags || [])
      .map((tag) => `<span>${ConnectHub.escapeHtml(tag)}</span>`)
      .join("");

    const paragraphHTML = (item.paragraphs || [])
      .map((paragraph) => `<p>${ConnectHub.escapeHtml(paragraph)}</p>`)
      .join("");

    article.appendChild(personIcon);

    const contentWrapper = document.createElement("div");
    contentWrapper.innerHTML = `
      <div class="person-name">${ConnectHub.escapeHtml(item.name || "")}</div>
      <div class="big-quote">"${ConnectHub.escapeHtml(item.quote || "")}"</div>
      ${paragraphHTML}
      <div class="story-tags">${tagSpans}</div>
    `;

    while (contentWrapper.firstChild) {
      article.appendChild(contentWrapper.firstChild);
    }

    track.appendChild(article);
  });

  // Duplicate cards for endless scrolling rail
  const originalCards = [...track.children];

  originalCards.forEach((card) => {
    const clonedCard = card.cloneNode(true);

    // Re-bind error listeners for cloned images
    const origImg = card.querySelector(".person-icon img");
    const clonedImg = clonedCard.querySelector(".person-icon img");

    if (origImg && clonedImg) {
      const initials = origImg.alt;
      setupImageErrorHandling(clonedImg, initials);
    }

    track.appendChild(clonedCard);
  });

  if (tagsWrapper) {
    const rawTags = [...track.querySelectorAll(".story-tags span")].map((tag) =>
      tag.textContent.trim(),
    );

    const uniqueTags = [...new Set(rawTags)];

    if (uniqueTags.length > 0) {
      const row1Tags = [];
      const row2Tags = [];

      uniqueTags.forEach((tag, index) => {
        if (index % 2 === 0) {
          row1Tags.push(tag);
        } else {
          row2Tags.push(tag);
        }
      });

      const tagRows = [
        { tags: row1Tags, direction: "left" },
        { tags: row2Tags, direction: "right" },
      ];

      tagRows.forEach(({ tags, direction }) => {
        if (tags.length === 0) return;

        const rowContainer = document.createElement("div");
        rowContainer.className = "floating-tags-row";

        const rowTrack = document.createElement("div");
        rowTrack.className = `floating-tags-track scroll-${direction}`;

        const createTagSpans = (list) => {
          const fragment = document.createDocumentFragment();

          list.forEach((text) => {
            const span = document.createElement("span");
            span.textContent = text;
            span.addEventListener("click", () => handleTagClick(text));
            fragment.appendChild(span);
          });

          return fragment;
        };

        rowTrack.appendChild(createTagSpans(tags));
        rowTrack.appendChild(createTagSpans(tags));

        const duration = Math.max(35, tags.length * 8);
        rowTrack.style.animationDuration = `${duration}s`;

        rowContainer.appendChild(rowTrack);
        tagsWrapper.appendChild(rowContainer);
      });
    }
  }

  if (carousel) {
    carousel.style.opacity = "1";
  }

  let spotlightTimer = null;

  function handleTagClick(selectedTag) {
    if (storyHeader) {
      storyHeader.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }

    const allCards = Array.from(document.querySelectorAll(".story-panel"));

    let targetCard = null;

    allCards.forEach((card) => {
      const cardTags = [...card.querySelectorAll(".story-tags span")].map((t) =>
        t.textContent.trim().toLowerCase(),
      );

      if (cardTags.includes(selectedTag.toLowerCase()) && !targetCard) {
        targetCard = card;
      }
    });

    if (targetCard && track && carousel) {
      if (spotlightTimer) {
        clearTimeout(spotlightTimer);
      }

      track.style.animationPlayState = "paused";

      const carouselWidth = carousel.offsetWidth;
      const cardOffsetLeft = targetCard.offsetLeft;
      const cardWidth = targetCard.offsetWidth;

      const targetTranslateX = -(
        cardOffsetLeft -
        (carouselWidth / 2 - cardWidth / 2)
      );

      track.style.transition = "transform 1.2s cubic-bezier(0.25, 1, 0.5, 1)";
      track.style.transform = `translateX(${targetTranslateX}px)`;

      allCards.forEach((card) => {
        if (card === targetCard) {
          card.classList.add("spotlight-active");
          card.classList.remove("dimmed");
        } else {
          card.classList.add("dimmed");
          card.classList.remove("spotlight-active");
        }
      });

      spotlightTimer = setTimeout(() => {
        track.style.transition = "";
        track.style.transform = "";

        allCards.forEach((card) => {
          card.classList.remove("dimmed", "spotlight-active");
        });

        track.style.animationPlayState = "running";
      }, 5000);
    }
  }
});
