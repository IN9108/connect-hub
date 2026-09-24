"""Package existing Power Pages copy as trusted templates with editable text slots."""

from html import unescape
from html.parser import HTMLParser
from pathlib import Path
import json
import re


ROOT = Path(__file__).resolve().parents[1]
PAGES = ROOT / "src/pa-knowledge-hub---knoweldgehub/web-pages"
OUT = ROOT / "power-platform/content-seed.json"
EXCLUDE = {"access-denied", "admin-dashboard", "login", "login-failed", "page-not-found", "profile", "search"}


def metadata(path):
    return dict(re.findall(r"^([a-z_]+):\s*(.*)$", path.read_text(encoding="utf-8"), re.M))


class Slots(HTMLParser):
    def __init__(self, source):
        super().__init__(convert_charrefs=False)
        self.source = source
        self.offsets = [0]
        for line in source.splitlines(keepends=True):
            self.offsets.append(self.offsets[-1] + len(line))
        self.replacements = []
        self.fields = {}
        self.descriptors = []
        self.current_tag = ""
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in {"script", "style"}:
            self.skip += 1
        self.current_tag = tag

    def handle_endtag(self, tag):
        if tag in {"script", "style"} and self.skip:
            self.skip -= 1
        self.current_tag = ""

    def handle_data(self, data):
        if self.skip or not data.strip() or "{{" in data or "{%" in data:
            return
        key = "title" if self.current_tag == "h1" and "title" not in self.fields else f"text_{len(self.fields) + 1:03d}"
        value = unescape(data.strip())
        line, col = self.getpos()
        start = self.offsets[line - 1] + col
        left = len(data) - len(data.lstrip())
        right = len(data.rstrip())
        self.replacements.append((start + left, start + right, f"[[field:{key}]]"))
        self.fields[key] = value
        label = value[:60].replace("\n", " ")
        self.descriptors.append({"key": key, "label": label, "type": "text"})


def template(source):
    parser = Slots(source)
    parser.feed(source)
    for start, end, replacement in reversed(parser.replacements):
        source = source[:start] + replacement + source[end:]

    def tag_replacement(match):
        tag = match.group()

        def attribute_replacement(attr):
            name, quote, value = attr.group(1), attr.group(2), attr.group(3)
            if not value.strip() or "{{" in value or "{%" in value or value.startswith("#"):
                return attr.group()
            if name in {"href", "src"} and not (value.startswith("/") or value.startswith("https://")):
                return attr.group()
            key = f"{name}_{len(parser.fields) + 1:03d}"
            parser.fields[key] = unescape(value)
            parser.descriptors.append({"key": key, "label": f"{name.upper()}: {unescape(value)[:52]}", "type": "url" if name in {"href", "src"} else "text"})
            return f"{name}={quote}[[field:{key}{':url' if name in {'href', 'src'} else ''}]]{quote}"

        return re.sub(r"\b(href|src|alt|title)\s*=\s*([\"'])(.*?)\2", attribute_replacement, tag, flags=re.S | re.I)

    source = re.sub(r"<(?:a|img)\b[^>]*>", tag_replacement, source, flags=re.S | re.I)
    return source, parser.fields, parser.descriptors


def main():
    roots = {}
    for path in PAGES.glob("*/*.webpage.yml"):
        meta = metadata(path)
        if meta.get("adx_isroot") == "true":
            roots[meta["adx_webpageid"]] = meta

    def url_for(meta):
        parts = []
        seen = set()
        while meta and meta.get("adx_webpageid") not in seen:
            seen.add(meta.get("adx_webpageid"))
            part = meta.get("adx_partialurl", "")
            if part and part != "/":
                parts.append(part)
            meta = roots.get(meta.get("adx_parentpageid"))
        return "/" + "/".join(reversed(parts))

    records, templates = [], {}
    for directory in sorted(PAGES.iterdir()):
        if not directory.is_dir() or directory.name in EXCLUDE or directory.name.endswith("-deleted"):
            continue
        yml = next(directory.glob("*.webpage.yml"), None)
        copy = next(directory.glob("content-pages/*.en-US.webpage.copy.html"), None)
        if not yml or not copy:
            continue
        meta = metadata(yml)
        raw = copy.read_text(encoding="utf-8-sig")
        if not raw.strip():
            continue
        html, fields, descriptors = template(raw)
        key = directory.name
        title = fields.get("title") or meta.get("adx_title") or meta.get("adx_name") or key.replace("-", " ").title()
        kind = "agent" if directory.name in {"hr-assistant", "qa-assistant"} else ("module" if directory.name not in {"agents", "ai-testimonies", "prompt-library", "training", "use-cases", "home"} else "page")
        hero_paragraph = re.search(r"<div class=\"training-hero[^\"]*\">.*?<p>(.*?)</p>", raw, re.S)
        description = re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", "", hero_paragraph.group(1)))).strip() if hero_paragraph else ""
        templates[key] = {"html": html, "editableFields": descriptors}
        content_yml = next(directory.glob("content-pages/*.en-US.webpage.yml"), None)
        content_meta = metadata(content_yml) if content_yml else {}
        launch = re.search(r'<a[^>]*class="training-button"[^>]*href="(https://[^"]+)"', raw)
        records.append({"kind": kind, "sourceKey": meta["adx_webpageid"], "parentPageId": meta.get("adx_parentpageid", ""),
                        "pageTemplateId": meta.get("adx_pagetemplateid", ""), "contentPageId": content_meta.get("adx_webpageid", ""),
                        "pageUrl": url_for(meta), "title": title,
                        "description": description, "slug": meta.get("adx_partialurl", key), "displayOrder": int(meta.get("adx_displayorder", "0") or 0),
                        "templateKey": key, "fields": fields, "editableFields": descriptors,
                        **({"launchUrl": launch.group(1)} if kind == "agent" and launch else {})})
    previous = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {"records": []}
    prompt_copy = (PAGES / "prompt-library/content-pages/Prompt-Library.en-US.webpage.copy.html").read_text(encoding="utf-8-sig")
    for index, card in enumerate(re.findall(r'<article class="prompt-card"([^>]*)>(.*?)</article>', prompt_copy, re.S), 1):
        attributes, body = card
        title_match = re.search(r"<h3>(.*?)</h3>", body, re.S)
        prompt_match = re.search(r'<div class="prompt-example">(.*?)</div>', body, re.S)
        category_match = re.search(r'data-category="([^"]+)"', attributes)
        if not title_match or not prompt_match:
            continue
        title = unescape(re.sub(r"<[^>]+>", "", title_match.group(1))).strip()
        prompt = unescape(re.sub(r"<[^>]+>", "", prompt_match.group(1))).strip()
        prompt = re.sub(r"\s+", " ", prompt)
        records.append({"kind": "prompt", "sourceKey": f"prompt:{index}", "pageUrl": "/prompt-library", "title": title,
                        "category": category_match.group(1) if category_match else "General", "prompt": prompt, "displayOrder": index})
    if not any(record["kind"] == "prompt" for record in records):
        records.extend(record for record in previous["records"] if record["kind"] == "prompt")

    stories_path = ROOT / "src/pa-knowledge-hub---knoweldgehub/web-files/ai-testimonies.json"
    for index, story in enumerate(json.loads(stories_path.read_text(encoding="utf-8-sig")), 1):
        name = story.get("name", "").strip()
        records.append({"kind": "testimony", "sourceKey": f"testimony:{index}", "pageUrl": "/ai-testimonies", "title": name,
                        "quote": story.get("quote", ""), "paragraphs": story.get("paragraphs", []), "tags": story.get("tags", []),
                        "imageUrl": story.get("image", {}).get("data", "") if isinstance(story.get("image"), dict) else "", "displayOrder": index})

    agents_copy = (PAGES / "agents/content-pages/Agents.en-US.webpage.copy.html").read_text(encoding="utf-8-sig")
    for index, card in enumerate(re.findall(r'<a href="([^"]+)" class="agent-card">(.*?)</a>', agents_copy, re.S), 1):
        launch_url, body = card
        title_match = re.search(r'<span class="agent-title">(.*?)</span>', body, re.S)
        description_match = re.search(r'<p>(.*?)</p>', body, re.S)
        target = next((record for record in records if record["kind"] == "agent" and record["pageUrl"].lower() == launch_url.lower()), None)
        if target and title_match:
            target["description"] = unescape(description_match.group(1).strip()) if description_match else ""
            target["displayOrder"] = index
    for prior in previous["records"]:
        if prior["kind"] == "agent":
            target = next((record for record in records if record["kind"] == "agent" and (record["sourceKey"] == prior["sourceKey"] or record["pageUrl"].lower() == prior.get("launchUrl", "").lower())), None)
            if target and not target.get("description"):
                target.update({key: prior[key] for key in ("description", "displayOrder") if key in prior})

    webfiles = ROOT / "src/pa-knowledge-hub---knoweldgehub/web-files"
    for path in sorted(webfiles.iterdir()):
        if path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"} or not path.is_file():
            continue
        yml = path.with_name(path.name + ".webfile.yml")
        if not yml.exists():
            continue
        meta = metadata(yml)
        media_id = meta.get("adx_webfileid", "")
        if not media_id:
            continue
        url = "/" + path.name
        records.append({"kind": "media", "sourceKey": "media:" + media_id, "mediaId": media_id, "pageUrl": url,
                        "imageUrl": url, "title": path.stem.replace("_", " ").replace("-", " ").strip(),
                        "description": "", "displayOrder": len(records) + 1})

    OUT.write_text(json.dumps({"version": 1, "templates": templates, "records": records}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(records)} records, {len(templates)} pages, {sum(len(template['editableFields']) for template in templates.values())} fields, {OUT.stat().st_size} bytes")


if __name__ == "__main__":
    main()
