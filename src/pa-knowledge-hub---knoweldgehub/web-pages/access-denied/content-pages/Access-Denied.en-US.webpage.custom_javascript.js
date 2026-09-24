document.addEventListener("DOMContentLoaded", () => {
  const errorPage = document.querySelector(".error-page");
  const floatingPrompts = document.querySelectorAll(".floating-prompt");
  const errorCards = document.querySelectorAll(".error-card");

  // 1. Mouse Parallax & Dynamic Radial Glow
  document.addEventListener("mousemove", (e) => {
    const { clientX, clientY } = e;
    const centerX = window.innerWidth / 2;
    const centerY = window.innerHeight / 2;

    if (errorPage) {
      errorPage.style.setProperty(
        "--mouse-x",
        `${(clientX / window.innerWidth) * 100}%`,
      );
      errorPage.style.setProperty(
        "--mouse-y",
        `${(clientY / window.innerHeight) * 100}%`,
      );
    }

    const moveX = (clientX - centerX) / 30;
    const moveY = (clientY - centerY) / 30;

    floatingPrompts.forEach((prompt, index) => {
      const factor = (index + 1) * 0.4;
      prompt.style.setProperty("--px", `${moveX * factor}px`);
      prompt.style.setProperty("--py", `${moveY * factor}px`);
    });
  });

  // 2. Interactive Prompt Pills (Copy to Clipboard)
  floatingPrompts.forEach((prompt) => {
    prompt.addEventListener("click", async () => {
      const text = prompt.innerText.trim();
      const originalText = prompt.innerText;

      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const textarea = document.createElement("textarea");
          textarea.value = text;
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand("copy");
          document.body.removeChild(textarea);
        }

        prompt.innerText = "Copied!";
        prompt.style.borderColor = "var(--primary)";

        setTimeout(() => {
          prompt.innerText = originalText;
          prompt.style.borderColor = "var(--border)";
        }, 1500);
      } catch (err) {
        console.error("Copy failed: ", err);
      }
    });
  });

  // 3. Smooth 3D Tilt Effect on Cards
  errorCards.forEach((card) => {
    card.addEventListener("mousemove", (e) => {
      const rect = card.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;

      const rotateX = (-y / rect.height) * 10;
      const rotateY = (x / rect.width) * 10;

      card.style.transition = "none";
      card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
    });

    card.addEventListener("mouseleave", () => {
      card.style.transition = "transform 0.4s ease, box-shadow 0.25s ease";
      card.style.transform = `perspective(1000px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)`;
    });
  });
});
