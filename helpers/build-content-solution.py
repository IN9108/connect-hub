"""Build the unmanaged Connect Hub solution from the exported 1.0.0.8 baseline.

The baseline is a tenant export. This script changes only known component rows,
adds the content tables and publisher flow, and fails on unknown site IDs.
"""

from __future__ import annotations

import base64
import copy
import json
import re
import uuid
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "src/pa-knowledge-hub---knoweldgehub"
BASE = ROOT / "ConnectHub_1_0_0_8.zip"
OUTPUT = ROOT / "ConnectHub_1_0_0_11.zip"
FLOW = ROOT / "power-platform/flows/ContentPublisher.flow.json"
SITE_ID = "4fcf5d22-8c56-43be-817c-8068dd99cfe3"
FLOW_ID = "a5c0090a-f3aa-4d67-916d-16f04f53e526"

ITEM_COLUMNS = {
    "kind": ("text", 40),
    "sourcekey": ("text", 200),
    "pageurl": ("text", 500),
    "draftjson": ("memo", 1_000_000),
    "publishedjson": ("memo", 1_000_000),
    "templatejson": ("memo", 1_000_000),
    "status": ("text", 40),
    "revision": ("int", None),
    "publishedrevision": ("int", None),
    "businessid": ("text", 36),
    "pageid": ("text", 36),
    "contentpageid": ("text", 36),
    "mediaid": ("text", 36),
}
OP_COLUMNS = {
    "itemid": ("text", 36),
    "revision": ("int", None),
    "kind": ("text", 40),
    "action": ("text", 40),
    "payloadjson": ("memo", 1_000_000),
    "pageurl": ("text", 500),
    "requestedby": ("text", 36),
    "status": ("text", 40),
    "error": ("memo", 20_000),
}
PUBLIC_COLUMNS = {
    "kind": ("text", 40),
    "publishedjson": ("memo", 1_000_000),
    "status": ("text", 40),
    "pageurl": ("text", 500),
}


def sub(el: ET.Element, name: str, value: str) -> None:
    child = el.find(name)
    if child is None:
        child = ET.SubElement(el, name)
    child.text = value


def label(el: ET.Element, text: str) -> None:
    node = el.find("displaynames/displayname")
    if node is not None:
        node.set("description", text)


def entity_from(template: ET.Element, integer_template: ET.Element, logical: str, columns: dict) -> ET.Element:
    entity = copy.deepcopy(template)
    title = {"contentitem": "Content Item", "contentoperation": "Content Operation", "publishedcontent": "Published Content"}[logical]
    schema = "crd38_" + logical
    info = entity.find("EntityInfo/entity")
    entity.find("Name").text = schema
    entity.find("Name").set("LocalizedName", title)
    entity.find("Name").set("OriginalName", title.replace(" ", ""))
    info.set("Name", schema)
    sub(info, "EntitySetName", "crd38_" + logical + "s")
    for path, value in (("LocalizedNames/LocalizedName", title), ("LocalizedCollectionNames/LocalizedCollectionName", title + "s")):
        node = info.find(path)
        if node is not None:
            node.set("description", value)
    attrs = info.find("attributes")
    existing = list(attrs)
    key = next(a for a in existing if a.findtext("Type") == "primarykey")
    primary = next(a for a in existing if "PrimaryName" in (a.findtext("DisplayMask") or ""))
    text = next(a for a in existing if a.get("PhysicalName") == "crd38_ImageUrl")
    memo = next(a for a in existing if a.findtext("Type") == "ntext")
    integer = integer_template
    for a in existing:
        if a.get("PhysicalName", "").lower().startswith("crd38_"):
            attrs.remove(a)
    key = copy.deepcopy(key)
    key.set("PhysicalName", "crd38_" + logical.title().replace("item", "Item").replace("operation", "Operation") + "Id")
    sub(key, "Name", schema + "id")
    sub(key, "LogicalName", schema + "id")
    label(key, title)
    attrs.insert(0, key)
    primary = copy.deepcopy(primary)
    primary.set("PhysicalName", "crd38_Name")
    sub(primary, "Name", "crd38_name")
    sub(primary, "LogicalName", "crd38_name")
    sub(primary, "MaxLength", "200")
    sub(primary, "Length", "400")
    label(primary, "Name")
    attrs.insert(1, primary)
    for col, (kind, limit) in columns.items():
        a = copy.deepcopy({"text": text, "memo": memo, "int": integer}[kind])
        a.set("PhysicalName", "crd38_" + col.title().replace("id", "Id").replace("json", "Json"))
        sub(a, "Name", "crd38_" + col)
        sub(a, "LogicalName", "crd38_" + col)
        sub(a, "RequiredLevel", "none")
        sub(a, "IsCustomField", "1")
        sub(a, "ValidForCreateApi", "1")
        sub(a, "ValidForUpdateApi", "1")
        sub(a, "ValidForReadApi", "1")
        if kind != "int":
            sub(a, "MaxLength", str(limit))
            if kind == "text":
                sub(a, "Length", str(limit * 2))
        label(a, col.replace("json", " JSON").title())
        attrs.append(a)
    for child in list(entity):
        if child.tag != "Name" and child.tag != "EntityInfo":
            entity.remove(child)
    # Cloned state/status option-set names identify localized-label owners in Dataverse.
    # Keeping the testimony names causes duplicate DisplayName labels during import.
    for node in entity.iter():
        for key, value in node.attrib.items():
            node.set(key, value.replace("crd38_aitestimony", schema).replace("AiTestimony", title))
        if node.text:
            node.text = node.text.replace("crd38_aitestimony", schema).replace("AiTestimony", title)
    assert "aitestimony" not in ET.tostring(entity, encoding="unicode").lower()
    return entity


def yaml_records(path: Path) -> list[dict[str, str]]:
    # The PAC export's scalar metadata is flat; multiline source is in sidecars.
    records = []
    record = {}
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        m = re.match(r"^(?:- )?([\w]+):(?: (.*))?$", line)
        if re.match(r"^- [\w]+:", line) and record:
            records.append(record)
            record = {}
        if m:
            raw = m.group(2) or ""
            record[m.group(1)] = raw.strip("'")
    if record:
        records.append(record)
    return records


def source_components() -> dict[str, tuple[dict, Path]]:
    result = {}
    primary_by_suffix = {
        ".webpage.yml": "adx_webpageid",
        ".webfile.yml": "adx_webfileid",
        ".webtemplate.yml": "adx_webtemplateid",
        ".pagetemplate.yml": "adx_pagetemplateid",
        ".serverlogic.yml": "adx_serverlogicid",
        ".tablepermission.yml": "adx_entitypermissionid",
        ".contentsnippet.yml": "adx_contentsnippetid",
        ".weblink.yml": "adx_weblinkid",
        ".weblinkset.yml": "adx_weblinksetid",
        ".uxcomponent.yml": "adx_uxcomponentid",
    }
    for yml in SITE.rglob("*.yml"):
        if yml.parent == SITE and yml.name in {"website.yml", "websitelanguage.yml"}:
            continue
        for data in yaml_records(yml):
            primary = next((field for suffix, field in primary_by_suffix.items() if yml.name.endswith(suffix)), None)
            id_fields = [primary] if primary and primary in data else [k for k in data if k.startswith("adx_") and k.endswith("id") and k not in {"adx_parentpageid", "adx_publishingstateid", "adx_rootwebpageid", "adx_webpagelanguageid", "adx_webtemplateid", "adx_pagetemplateid"}]
            if len(id_fields) != 1:
                continue
            rowid = data[id_fields[0]].lower()
            if re.fullmatch(r"[0-9a-f-]{36}", rowid):
                result[rowid] = data, yml
    return result


def patch_component(xml: bytes, data: dict, yml: Path) -> bytes:
    row = ET.fromstring(xml)
    content = json.loads(row.findtext("content") or "{}")
    component_type = int(row.findtext("powerpagecomponenttype"))
    fields = {
        2: {"adx_displayorder": "displayorder", "adx_name": "_name", "adx_title": "title", "adx_partialurl": "partialurl", "adx_parentpageid": "parentpageid", "adx_pagetemplateid": "pagetemplateid", "adx_publishingstateid": "publishingstateid", "adx_rootwebpageid": "rootwebpageid", "adx_webpagelanguageid": "webpagelanguageid", "adx_isroot": "isroot", "adx_hiddenfromsitemap": "hiddenfromsitemap", "adx_excludefromsearch": "excludefromsearch", "adx_sharedpageconfiguration": "sharedpageconfiguration", "adx_enablerating": "enablerating", "adx_enabletracking": "enabletracking"},
        3: {"adx_name": "_name", "adx_partialurl": "partialurl", "adx_parentpageid": "parentpageid", "adx_publishingstateid": "publishingstateid", "adx_hiddenfromsitemap": "hiddenfromsitemap", "adx_excludefromsearch": "excludefromsearch", "adx_contentdisposition": "contentdisposition"},
        8: {"adx_name": "_name"},
        35: {"adx_name": "_name", "adx_display_name": "display_name", "adx_description": "description"},
        18: {"adx_entityname": "_name", "adx_entitylogicalname": "entitylogicalname", "adx_scope": "scope", "adx_read": "read", "adx_write": "write", "adx_create": "create", "adx_delete": "delete", "adx_append": "append", "adx_appendto": "appendto"},
    }.get(component_type, {})
    for key, target in fields.items():
        if key not in data:
            continue
        raw = data[key]
        value = {"true": True, "false": False}.get(raw, raw)
        if isinstance(value, str) and re.fullmatch(r"-?\d+", value):
            value = int(value)
        if target == "_name":
            sub(row, "name", str(value))
            if component_type == 18:
                content["entityname"] = str(value)
        else:
            content[target] = value
    for key, raw in data.items():
        target = key.removeprefix("adx_")
        if key.startswith("adx_") and key not in fields and target in content and target not in {"filecontent", "source", "copy"}:
            content[target] = {"true": True, "false": False}.get(raw, int(raw) if re.fullmatch(r"-?\d+", raw) else raw)
    stem = yml.name[:-4]
    sidecars = {"copy": ".copy.html", "summary": ".summary.html", "customcss": ".custom_css.css", "customjavascript": ".custom_javascript.js", "source": ".source.html"}
    for field, suffix in sidecars.items():
        path = yml.with_name(stem + suffix)
        if path.exists():
            content[field] = path.read_text(encoding="utf-8-sig")
    if component_type == 35:
        js = yml.with_name(yml.name.removesuffix(".serverlogic.yml") + ".js")
        if js.exists():
            content["filecontent"] = base64.b64encode(js.read_bytes()).decode()
        roles = re.findall(r"^- ([0-9a-f-]{36})$", yml.read_text(encoding="utf-8-sig"), re.MULTILINE)
        if roles:
            content["adx_serverlogic_adx_webrole"] = roles
    if component_type == 18:
        for key in ("parentrelationship", "parententitypermission", "contactrelationship", "accountrelationship", "permissionfetchxml"):
            content.setdefault(key, None)
        content.setdefault("childTablePermissions", [])
        role = re.search(r"adx_entitypermission_webrole:\s*\n- ([0-9a-f-]{36})", yml.read_text(encoding="utf-8-sig"))
        if role:
            content["adx_entitypermission_webrole"] = [role.group(1)]
    sub(row, "content", json.dumps(content, ensure_ascii=False, separators=(",", ":")))
    return ET.tostring(row, encoding="utf-8")


def main() -> None:
    with zipfile.ZipFile(BASE) as base:
        files = {name: base.read(name) for name in base.namelist()}
    custom = ET.fromstring(files["customizations.xml"])
    template = next(e for e in custom.find("Entities") if e.findtext("Name") == "crd38_AiTestimony")
    path_entity = next(e for e in custom.find("Entities") if e.findtext("Name") == "crd38_LearningPath")
    integer = next(a for a in path_entity.find("EntityInfo/entity/attributes") if a.get("PhysicalName") == "crd38_DisplayOrder")
    for logical, columns in (("contentitem", ITEM_COLUMNS), ("contentoperation", OP_COLUMNS), ("publishedcontent", PUBLIC_COLUMNS)):
        custom.find("Entities").append(entity_from(template, integer, logical, columns))
    workflows = custom.find("Workflows")
    workflow = copy.deepcopy(workflows.find("Workflow"))
    workflow.set("WorkflowId", "{" + FLOW_ID + "}")
    workflow.set("Name", "Content Publisher")
    sub(workflow, "JsonFileName", "/Workflows/ContentPublisher-" + FLOW_ID.upper() + ".json")
    workflow.find("LocalizedNames/LocalizedName").set("description", "Content Publisher")
    workflows.append(workflow)
    files["customizations.xml"] = ET.tostring(custom, encoding="utf-8", xml_declaration=True)
    solution = ET.fromstring(files["solution.xml"])
    sub(solution.find("SolutionManifest"), "Version", "1.0.0.11")
    roots = solution.find("SolutionManifest/RootComponents")
    for logical in ("contentitem", "contentoperation", "publishedcontent"):
        ET.SubElement(roots, "RootComponent", {"type": "1", "schemaName": "crd38_" + logical, "behavior": "0"})
    ET.SubElement(roots, "RootComponent", {"type": "29", "id": "{" + FLOW_ID + "}", "behavior": "0"})
    files["solution.xml"] = ET.tostring(solution, encoding="utf-8", xml_declaration=True)
    files["Workflows/ContentPublisher-" + FLOW_ID.upper() + ".json"] = FLOW.read_bytes()
    sources = source_components()
    seen = set()
    for path in list(files):
        m = re.fullmatch(r"powerpagecomponents/([0-9a-f-]{36})/powerpagecomponent.xml", path)
        if not m or m.group(1) not in sources:
            continue
        rowid = m.group(1)
        data, yml = sources[rowid]
        files[path] = patch_component(files[path], data, yml)
        seen.add(rowid)
        row = ET.fromstring(files[path])
        component_type = row.findtext("powerpagecomponenttype")
        if component_type in {"3", "35"}:
            if component_type == "3":
                filename = data.get("filename") or yml.name.removesuffix(".webfile.yml")
                source = yml.with_name(filename)
            else:
                source = yml.with_name(yml.name.removesuffix(".serverlogic.yml") + ".js")
            file_ref = row.findtext("filecontent")
            if source.exists() and file_ref:
                asset_path = next((p for p in files if p.startswith(f"powerpagecomponents/{rowid}/filecontent/")), None)
                if asset_path:
                    files[asset_path] = source.read_bytes()
    missing = set(sources) - seen
    templates = {}
    for path, content in files.items():
        m = re.fullmatch(r"powerpagecomponents/([0-9a-f-]{36})/powerpagecomponent.xml", path)
        if m:
            row = ET.fromstring(content)
            templates.setdefault(int(row.findtext("powerpagecomponenttype")), row)
    for rowid in sorted(missing):
        data, yml = sources[rowid]
        if yml.name.endswith(".webfile.yml"):
            kind = 3
        elif yml.name.endswith(".tablepermission.yml"):
            kind = 18
        elif yml.name.endswith(".serverlogic.yml"):
            kind = 35
        else:
            raise ValueError(f"Cannot add new site source: {yml}")
        row = copy.deepcopy(templates[kind])
        row.set("powerpagecomponentid", rowid)
        sub(row, "name", data.get("adx_name") or data.get("adx_entityname") or rowid)
        sub(row, "content", "{}")
        if kind == 3:
            filename = data.get("filename") or yml.name.removesuffix(".webfile.yml")
            asset = yml.with_name(filename)
            if not asset.exists():
                raise FileNotFoundError(asset)
            sub(row, "filecontent", filename)
            row.find("filecontent").set("mimetype", data.get("mimetype") or "application/octet-stream")
            files[f"powerpagecomponents/{rowid}/filecontent/{filename}"] = asset.read_bytes()
        else:
            file_node = row.find("filecontent")
            if file_node is not None:
                row.remove(file_node)
        path = f"powerpagecomponents/{rowid}/powerpagecomponent.xml"
        files[path] = patch_component(ET.tostring(row, encoding="utf-8"), data, yml)
        seen.add(rowid)
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as out:
        for path, content in files.items():
            out.writestr(path, content)
    with zipfile.ZipFile(OUTPUT) as package:
        for rowid, (data, yml) in sources.items():
            if not yml.name.endswith(".serverlogic.yml"):
                continue
            script = yml.with_name(yml.name.removesuffix(".serverlogic.yml") + ".js").read_bytes()
            row = ET.fromstring(package.read(f"powerpagecomponents/{rowid}/powerpagecomponent.xml"))
            assert base64.b64decode(json.loads(row.findtext("content"))["filecontent"]) == script
            asset = next((p for p in package.namelist() if p.startswith(f"powerpagecomponents/{rowid}/filecontent/")), None)
            if asset:
                assert package.read(asset) == script
    print(f"Built {OUTPUT.name}; patched {len(seen)} site components")


if __name__ == "__main__":
    main()
