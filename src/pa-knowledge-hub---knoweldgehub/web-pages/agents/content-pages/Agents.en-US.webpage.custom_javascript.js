document.addEventListener("DOMContentLoaded", async () => {
  const grid = document.querySelector(".agent-grid");
  if (!grid) return;
  try {
    if (!window.ConnectHubContent) await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/content.js";
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
    const agents = await ConnectHubContent.list("agent");
    grid.innerHTML = agents.map((item) => ConnectHubContent.renderCard(item, "agent")).join("") || '<p role="status">No agents are published yet.</p>';
  } catch (error) {
    console.error("Unable to load agents:", error);
    grid.innerHTML = '<p role="alert">Agents are unavailable right now. Please try again later.</p>';
  }
});
