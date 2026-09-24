"""Generate the Connect Hub Dataverse publishing flow from one source."""

from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
TARGET = ROOT / "power-platform/flows/ContentPublisher.flow.json"
HOST = {"apiId": "/providers/Microsoft.PowerApps/apis/shared_commondataserviceforapps", "connectionName": "shared_commondataserviceforapps"}
SITE = "4fcf5d22-8c56-43be-817c-8068dd99cfe3"
PUBLISHED = "5e4f81ac-2be7-40b2-a145-28ab2c6bd3aa"
DRAFT = "f071ded7-9951-4e29-9c19-8c3405e9d9d0"
LANGUAGE = "0efd3c55-b7ce-474b-81e1-65fb1fb49f70"


def e(source: str) -> str:
    return "@" + source


def p(key: str) -> str:
    return e(f"outputs('Payload')?['{key}']")


def dv(operation: str, **parameters) -> dict:
    return {"type": "OpenApiConnection", "inputs": {"parameters": parameters, "host": HOST | {"operationId": operation}}}


def update(table: str, rowid: str, **fields) -> dict:
    return dv("UpdateOnlyRecord", entityName=table, recordId=rowid, **{"item/" + k: v for k, v in fields.items()})


def create(table: str, **fields) -> dict:
    return dv("CreateRecord", entityName=table, **{"item/" + k: v for k, v in fields.items()})


def listrow(table: str, field: str, value: str) -> dict:
    field_expr = field[1:] if field.startswith("@") else f"'{field}'"
    return dv("ListRecords", entityName=table, **{"$filter": e(f"concat({field_expr},' eq ',{value[1:]})"), "$top": 1})


def after(action: dict, previous: str) -> dict:
    action["runAfter"] = {previous: ["Succeeded"]}
    return action


def branch(test: str, yes: dict, no: dict | None = None) -> dict:
    return {"type": "If", "expression": e(test), "actions": yes, "else": {"actions": no or {}}}


def fail(prefix: str, message: str) -> dict:
    mark = prefix + "_mark_failed"
    return {
        mark: update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="failed", crd38_error=message),
        prefix + "_stop": after({"type": "Terminate", "inputs": {"runStatus": "Failed", "runError": {"message": message}}}, mark),
    }


def changeset(actions: dict) -> dict:
    # Shape matches a public Power Automate solution export with this connector.
    return {"type": "Changeset", "kind": "ODataOpenApiConnection", "inputs": {"host": HOST | {"operationId": "ExecuteChangeset"}}, "actions": actions}


def object_expr(fields: dict[str, str]) -> str:
    obj = "json('{}')"
    for key, value in fields.items():
        obj = f"setProperty({obj},'{key}',{value})"
    return e(f"string({obj})")


def snapshot(publishing: bool) -> dict:
    fields = {"crd38_name": "outputs('Payload')?['title']", "crd38_kind": "outputs('Payload')?['kind']", "crd38_publishedjson": "outputs('Payload')?['publishedJson']" if publishing else "''", "crd38_status": "'published'" if publishing else "'unpublished'", "crd38_pageurl": "outputs('Payload')?['pageUrl']"}
    return update("crd38_publishedcontents", p("itemId"), **{key: e(value) for key, value in fields.items()})


def stage_snapshot(prefix: str, previous: str | None = None) -> tuple[dict, str]:
    lookup = prefix + "_lookup_public"
    stage = prefix + "_stage_public"
    actions = {lookup: listrow("crd38_publishedcontents", "crd38_publishedcontentid", p("itemId"))}
    if previous:
        after(actions[lookup], previous)
    actions[stage] = after(branch(f"empty(outputs('{lookup}')?['body/value'])", {prefix + "_create_public": create("crd38_publishedcontents", crd38_publishedcontentid=p("itemId"), crd38_name=p("title"), crd38_kind=p("kind"), crd38_status="unpublished", crd38_publishedjson="", crd38_pageurl=p("pageUrl"))}), lookup)
    return actions, stage


def stage_business(prefix: str, publishing: bool, create_commit: dict, update_commit: dict) -> dict:
    if not publishing:
        return {prefix + "_commit": update_commit}
    lookup = prefix + "_lookup_business"
    return {
        lookup: listrow(p("businessTable"), p("businessKey"), p("businessId")),
        prefix + "_new_or_existing": after(branch(f"empty(outputs('{lookup}')?['body/value'])", {prefix + "_commit_new": create_commit}, {prefix + "_commit_existing": update_commit}), lookup),
    }


def page_draft(localized: bool) -> str:
    fields = {
        "displayorder": "json(outputs('Payload')?['draftJson'])?['displayOrder']",
        "pagetemplateid": "outputs('Payload')?['pageTemplateId']",
        "parentpageid": "outputs('Payload')?['parentPageId']",
        "partialurl": "outputs('Payload')?['slug']",
        "isroot": "false" if localized else "true",
        "title": "outputs('Payload')?['title']",
        "copy": "outputs('Payload')?['html']" if localized else "''",
        "publishingstateid": f"'{DRAFT}'",
        "hiddenfromsitemap": "false",
        "excludefromsearch": "false",
        "sharedpageconfiguration": "false",
    }
    if localized:
        fields |= {"rootwebpageid": "outputs('Payload')?['pageId']", "webpagelanguageid": f"'{LANGUAGE}'"}
    return object_expr(fields)


def media_content(state: str) -> str:
    return object_expr({"partialurl": "outputs('Payload')?['filename']", "parentpageid": "outputs('Payload')?['parentPageId']", "publishingstateid": f"'{state}'", "contentdisposition": "756150000", "hiddenfromsitemap": "false", "excludefromsearch": "false"})


def page_create(localized: bool) -> dict:
    return create("powerpagecomponents", powerpagecomponentid=p("contentPageId" if localized else "pageId"), name=p("title"), powerpagecomponenttype=2, **{"powerpagesiteid@odata.bind": f"/powerpagesites({SITE})"}, content=page_draft(localized), searchcontent=p("title"))


def page_update(localized: bool, state: str, lookup: str) -> dict:
    current = f"if(empty(outputs('{lookup}')?['body/value']),json({page_draft(localized)[1:]}),json(first(outputs('{lookup}')?['body/value'])?['content']))"
    if state == PUBLISHED:
        content = f"setProperty({current},'title',outputs('Payload')?['title'])"
        if localized:
            content = f"setProperty({content},'copy',outputs('Payload')?['html'])"
        content = f"setProperty({content},'publishingstateid','{state}')"
    else:
        content = f"setProperty({current},'publishingstateid','{state}')"
    return update("powerpagecomponents", p("contentPageId" if localized else "pageId"), content=e(f"string({content})"), name=p("title"))


def item_fields(save: bool) -> dict:
    fields = {"crd38_name": p("title"), "crd38_kind": p("kind"), "crd38_pageurl": p("pageUrl"), "crd38_sourcekey": p("sourceKey"), "crd38_businessid": p("businessId"), "crd38_pageid": p("pageId"), "crd38_contentpageid": p("contentPageId"), "crd38_mediaid": p("mediaId")}
    if save:
        fields |= {"crd38_draftjson": p("draftJson"), "crd38_templatejson": p("templateJson"), "crd38_revision": p("revision")}
    return fields


def commit(prefix: str, publishing: bool, page_lookups: tuple[str, str] | None, business: bool, business_create: bool = False) -> dict:
    actions = {}
    state = PUBLISHED if publishing else DRAFT
    if page_lookups:
        actions[prefix + "_root"] = page_update(False, state, page_lookups[0])
        actions[prefix + "_localized"] = page_update(True, state, page_lookups[1])
    if business:
        if business_create:
            body = "setProperty(removeProperty(outputs('Payload')?['businessPayload'],'statecode'),outputs('Payload')?['businessKey'],outputs('Payload')?['businessId'])"
            actions[prefix + "_business"] = dv("CreateRecord", entityName=p("businessTable"), item=e(body))
        else:
            actions[prefix + "_business"] = dv("UpdateOnlyRecord", entityName=p("businessTable"), recordId=p("businessId"), item=p("businessPayload"))
    values = {"crd38_status": "published" if publishing else "unpublished"}
    if publishing:
        values |= {"crd38_publishedjson": p("publishedJson"), "crd38_publishedrevision": p("revision")}
    actions[prefix + "_item"] = update("crd38_contentitems", p("itemId"), **values)
    actions[prefix + "_public"] = snapshot(publishing)
    actions[prefix + "_done"] = update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="succeeded")
    return changeset(actions)


def page_branch(prefix: str, publishing: bool) -> dict:
    lookup_root, lookup_local = prefix + "_get_root", prefix + "_get_localized"
    actions = {
        lookup_root: listrow("powerpagecomponents", "powerpagecomponentid", p("pageId")),
        lookup_local: listrow("powerpagecomponents", "powerpagecomponentid", p("contentPageId")),
    }
    after(actions[lookup_local], lookup_root)
    previous = lookup_local
    if publishing:
        stage_root = prefix + "_stage_root"
        stage_local = prefix + "_stage_localized"
        actions[stage_root] = after(branch(f"empty(outputs('{lookup_root}')?['body/value'])", {prefix + "_create_root": page_create(False)}), previous)
        actions[stage_local] = after(branch(f"empty(outputs('{lookup_local}')?['body/value'])", {prefix + "_create_localized": page_create(True)}), stage_root)
        previous = stage_local
    else:
        valid = prefix + "_pages_exist"
        actions[valid] = after(branch(f"and(not(empty(outputs('{lookup_root}')?['body/value'])),not(empty(outputs('{lookup_local}')?['body/value'])))", {}, fail(prefix + "_missing_pages", "Published page records are missing.")), previous)
        previous = valid
    public_actions, previous = stage_snapshot(prefix, previous)
    actions.update(public_actions)
    has_business = prefix + "_has_business"
    actions[has_business] = after(branch("not(empty(outputs('Payload')?['businessTable']))", stage_business(prefix + "b", publishing, commit(prefix + "bn", publishing, (lookup_root, lookup_local), True, True), commit(prefix + "be", publishing, (lookup_root, lookup_local), True)), {prefix + "_commit_plain": commit(prefix + "p", publishing, (lookup_root, lookup_local), False)}), previous)
    return actions


def simple_branch(prefix: str, publishing: bool) -> dict:
    actions, previous = stage_snapshot(prefix)
    actions[prefix + "_has_business"] = after(branch("not(empty(outputs('Payload')?['businessTable']))", stage_business(prefix + "b", publishing, commit(prefix + "bn", publishing, None, True, True), commit(prefix + "be", publishing, None, True)), {prefix + "_commit_plain": commit(prefix + "p", publishing, None, False)}), previous)
    return actions


def validate(actions: dict) -> None:
    names = set()

    def walk(group: dict, depth: int = 0) -> None:
        assert depth <= 8, f"Flow nesting exceeds eight levels: {depth}"
        for name, action in group.items():
            assert name not in names, f"Duplicate action name: {name}"
            names.add(name)
            for dependency in action.get("runAfter", {}):
                assert dependency in group, f"{name} depends on a non-sibling action: {dependency}"
            if "actions" in action:
                walk(action["actions"], depth + 1)
            if "else" in action:
                walk(action["else"]["actions"], depth + 1)

    walk(actions)


def main() -> None:
    baseline = json.loads((ROOT / "power-platform/flows/ContactFiller.flow.json").read_text(encoding="utf-8"))
    reference = baseline["properties"]["connectionReferences"]["shared_commondataserviceforapps"]
    definition = {"$schema": baseline["properties"]["definition"]["$schema"], "contentVersion": "1.0.0.0", "parameters": baseline["properties"]["definition"]["parameters"], "triggers": {"When_operation_created": {"type": "OpenApiConnectionWebhook", "inputs": {"parameters": {"subscriptionRequest/message": 1, "subscriptionRequest/entityname": "crd38_contentoperation", "subscriptionRequest/scope": 4}, "host": HOST | {"operationId": "SubscribeWebhookTrigger"}}, "runtimeConfiguration": {"concurrency": {"runs": 1}}}}, "actions": {}}
    flow = {"properties": {"connectionReferences": {"shared_commondataserviceforapps": reference}, "definition": definition, "templateName": None}, "schemaVersion": "1.0.0.0"}
    actions = definition["actions"]
    actions["Payload"] = {"type": "Compose", "inputs": e("json(triggerOutputs()?['body/crd38_payloadjson'])")}
    actions["Live_operation"] = after(dv("GetItem", entityName="crd38_contentoperations", recordId=e("triggerOutputs()?['body/crd38_contentoperationid']")), "Payload")
    actions["Only_queued"] = after(branch("equals(outputs('Live_operation')?['body/crd38_status'],'queued')", {}, {"Skip_processed": {"type": "Terminate", "inputs": {"runStatus": "Cancelled"}}}), "Live_operation")
    actions["Mark_running"] = after(update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="running"), "Only_queued")
    process = {"type": "Scope", "actions": {}}
    actions["Process"] = after(process, "Mark_running")
    work = process["actions"]
    work["Existing_item"] = listrow("crd38_contentitems", "crd38_contentitemid", p("itemId"))
    valid = "and(equals(outputs('Payload')?['itemId'],triggerOutputs()?['body/crd38_itemid']),or(and(empty(outputs('Existing_item')?['body/value']),equals(int(outputs('Payload')?['expectedRevision']),0),or(equals(outputs('Payload')?['action'],'save'),equals(outputs('Payload')?['kind'],'media'))),and(not(empty(outputs('Existing_item')?['body/value'])),equals(int(coalesce(first(outputs('Existing_item')?['body/value'])?['crd38_revision'],-1)),int(outputs('Payload')?['expectedRevision'])))))"
    work["Revision_guard"] = after(branch(valid, {}, fail("Revision_conflict", "Someone changed this content. Reload and retry.")), "Existing_item")

    save = {}
    save["Save_check_route"] = branch("not(empty(outputs('Payload')?['pageUrl']))", {
        "Save_lookup_route": dv("ListRecords", entityName="crd38_contentitems", **{"$filter": e("concat('crd38_pageurl eq ',decodeUriComponent('%27'),outputs('Payload')?['pageUrl'],decodeUriComponent('%27'),' and crd38_contentitemid ne ',outputs('Payload')?['itemId'])"), "$top": 1}),
        "Save_route_available": after(branch("empty(outputs('Save_lookup_route')?['body/value'])", {}, fail("Save_route_conflict", "That page address is already in use.")), "Save_lookup_route"),
    })
    save["Save_new_or_existing"] = after(branch("empty(outputs('Existing_item')?['body/value'])", {
        "Save_new_transaction": changeset({
            "Save_new_item": create("crd38_contentitems", crd38_contentitemid=p("itemId"), crd38_status="draft", **item_fields(True)),
            "Save_new_done": update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="succeeded"),
        })
    }, {
        "Save_existing_transaction": changeset({
            "Save_existing_item": update("crd38_contentitems", p("itemId"), **item_fields(True)),
            "Save_existing_done": update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="succeeded"),
        })
    }), "Save_check_route")
    work["If_save"] = after(branch("equals(outputs('Payload')?['action'],'save')", save), "Revision_guard")

    media = {}
    media["Media_create_item_if_missing"] = branch("empty(outputs('Existing_item')?['body/value'])", {"Media_create_item": create("crd38_contentitems", crd38_contentitemid=p("itemId"), crd38_status="draft", **item_fields(True))})
    media["Media_existing_file"] = after(listrow("powerpagecomponents", "powerpagecomponentid", p("mediaId")), "Media_create_item_if_missing")
    media["Media_safe_to_upload"] = after(branch(f"or(empty(outputs('Media_existing_file')?['body/value']),equals(json(coalesce(first(outputs('Media_existing_file')?['body/value'])?['content'],'{{}}'))?['publishingstateid'],'{DRAFT}'))", {}, fail("Media_live_overwrite", "Existing published image cannot be overwritten.")), "Media_existing_file")
    media["Media_stage"] = after(branch("empty(outputs('Media_existing_file')?['body/value'])", {"Media_create_file_draft": create("powerpagecomponents", powerpagecomponentid=p("mediaId"), name=p("filename"), powerpagecomponenttype=3, **{"powerpagesiteid@odata.bind": f"/powerpagesites({SITE})"}, content=media_content(DRAFT))}), "Media_safe_to_upload")
    media["Media_upload_file"] = after(dv("UpdateEntityFileImageFieldContent", entityName="powerpagecomponents", recordId=p("mediaId"), fileImageFieldName="filecontent", item=e("base64ToBinary(outputs('Payload')?['base64'])"), **{"x-ms-file-name": p("filename")}), "Media_stage")
    public_actions, public_previous = stage_snapshot("Media", "Media_upload_file")
    media.update(public_actions)
    media["Media_commit"] = after(changeset({
        "Media_publish_file": update("powerpagecomponents", p("mediaId"), content=media_content(PUBLISHED)),
        "Media_publish_item": update("crd38_contentitems", p("itemId"), crd38_status="published", crd38_publishedjson=p("publishedJson"), crd38_publishedrevision=p("revision")),
        "Media_publish_public": snapshot(True),
        "Media_complete": update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="succeeded"),
    }), public_previous)
    work["If_media"] = after(branch("and(equals(outputs('Payload')?['action'],'publish'),equals(outputs('Payload')?['kind'],'media'))", media), "If_save")

    work["If_page_publish"] = after(branch("and(equals(outputs('Payload')?['action'],'publish'),not(equals(outputs('Payload')?['kind'],'media')),not(empty(outputs('Payload')?['pageId'])))", page_branch("Page_publish", True)), "If_media")
    work["If_simple_publish"] = after(branch("and(equals(outputs('Payload')?['action'],'publish'),not(equals(outputs('Payload')?['kind'],'media')),empty(outputs('Payload')?['pageId']))", simple_branch("Simple_publish", True)), "If_page_publish")
    work["If_page_unpublish"] = after(branch("and(equals(outputs('Payload')?['action'],'unpublish'),not(empty(outputs('Payload')?['pageId'])))", page_branch("Page_unpublish", False)), "If_simple_publish")
    work["If_simple_unpublish"] = after(branch("and(equals(outputs('Payload')?['action'],'unpublish'),empty(outputs('Payload')?['pageId']))", simple_branch("Simple_unpublish", False)), "If_page_unpublish")
    actions["Failure_status"] = {"type": "Scope", "actions": {"Check_failed_operation": dv("GetItem", entityName="crd38_contentoperations", recordId=e("triggerOutputs()?['body/crd38_contentoperationid']")), "If_still_running": after(branch("equals(outputs('Check_failed_operation')?['body/crd38_status'],'running')", {"Mark_failed": update("crd38_contentoperations", e("triggerOutputs()?['body/crd38_contentoperationid']"), crd38_status="failed", crd38_error="The operation failed. Ask an administrator to inspect the publisher flow run.")}), "Check_failed_operation")}, "runAfter": {"Process": ["Failed", "TimedOut"]}}
    validate(actions)
    TARGET.write_text(json.dumps(flow, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(TARGET)


if __name__ == "__main__":
    main()
