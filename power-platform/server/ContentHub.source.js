// Only published fields cross this endpoint. Drafts and operations stay admin-only.
function contentRead(table, query) {
  const rows = [];
  for (let page = 0; page < 100; page++) {
    const raw = Server.Connector.Dataverse.RetrieveMultipleRecords(table, query, true);
    const envelope = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!envelope || envelope.IsSuccessStatusCode === false || envelope.ServerError || Number(envelope.StatusCode) >= 400) throw new Error("Content is unavailable. Please try again.");
    const body = typeof envelope.Body === "string" ? JSON.parse(envelope.Body) : envelope.Body;
    if (!Array.isArray(body?.value)) throw new Error("Content is unavailable. Please try again.");
    rows.push(...body.value);
    const next = body["@odata.nextLink"];
    if (!next) return rows;
    if (typeof next !== "string" || !next.includes("?")) throw new Error("Invalid content paging response.");
    query = next.slice(next.indexOf("?") + 1);
  }
  throw new Error("The content list could not be loaded completely.");
}
function get() {
  try {
    if (!Server.User?.contactid) throw new Error("Sign in is required.");
    const query = Server.Context.QueryParameters || {};
    if (query.action !== "list" || !["prompt", "agent", "testimony"].includes(query.kind)) throw new Error("Unsupported content request.");
    const table = "crd38_publishedcontents";
    const marker = contentRead(table, "$select=crd38_publishedcontentid&$filter=crd38_publishedcontentid eq 66d49808-7090-5a75-95ca-353020f9f169&$top=1");
    let data;
    if (marker.length) {
      const rows = contentRead(table, "$select=crd38_publishedcontentid,crd38_publishedjson,crd38_pageurl&$filter=crd38_kind eq '" + query.kind + "' and crd38_status eq 'published'");
      data = rows.filter(row => row.crd38_publishedjson).map(row => ({ ...JSON.parse(row.crd38_publishedjson), id: row.crd38_publishedcontentid, pageUrl: row.crd38_pageurl || "" }));
    } else {
      // Only during initial migration; never fall back after a manager unpublishes content.
      data = CONTENT_SEED.records.filter(row => row.kind === query.kind).map(row => ({ ...row, id: row.itemId }));
      if (query.kind === "testimony") {
        const live = contentRead("crd38_aitestimonies", "$filter=statecode eq 0");
        const byName = new Map(data.map(row => [row.title.toLowerCase(), row]));
        for (const row of live) {
          if (String(row.crd38_name).toLowerCase() === "test" && String(row.crd38_quote).toLowerCase() === "test") continue;
          byName.set(String(row.crd38_name).toLowerCase(), { id: row.crd38_aitestimonyid, title: row.crd38_name, quote: row.crd38_quote,
            paragraphs: String(row.crd38_paragraphs || "").split(/\n\s*\n/).filter(Boolean), tags: String(row.crd38_tags || "").split(",").map(tag => tag.trim()).filter(Boolean), imageUrl: row.crd38_imageurl || "", displayOrder: 0 });
        }
        data = [...byName.values()];
      }
    }
    data.sort((a, b) => (a.displayOrder || 0) - (b.displayOrder || 0) || String(a.title).localeCompare(String(b.title)));
    return JSON.stringify({ success: true, data });
  } catch (error) { return JSON.stringify({ success: false, message: error.message }); }
}
