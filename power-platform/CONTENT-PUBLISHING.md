# Connect Hub content publishing

## Delivery

`ConnectHub_1_0_0_10.zip` is an unmanaged solution built from the repository's `ConnectHub_1_0_0_8.zip`. It includes the current site source, three content tables, table permissions, the ContentHub server endpoint, and the Content Publisher cloud flow. The baseline ZIP is unchanged. Version 1.0.0.10 fixes the public content API envelope parsing used by Agents, Testimonies and Prompt Library. It also gives each new table its own state and status option-set names; the earlier package copied the testimony names and the tenant rejected its localized labels during import.

Local checks cover source contracts, input validation, simulated Dataverse requests, editor operations, flow structure, and package contents. They do not establish successful tenant import, flow activation, a real page/image creation, or a live Power Pages render. The local browser preview was blocked by browser security policy; no alternate browser workaround was attempted.

## One-time setup by the platform owner

1. Import the unmanaged solution into the intended development environment for this existing enhanced-data-model website. The package uses that website's existing IDs; it is not a template for an unrelated site.
2. Bind its existing Microsoft Dataverse connection reference to the intended publisher identity. Give that identity the required create/read/update access to the three new tables, the existing learning-path/module/testimony tables, and Power Pages components and file content. Activate **Content Publisher** and confirm its Dataverse create trigger is registered. Keep trigger concurrency at one.
3. Confirm the manager's contact belongs to the website's **Administrators** web role. The separate existing role named **Admin** does not grant access to this dashboard endpoint. Ordinary signed-in users only read the published snapshot table. Do not expose the private content or operation tables through the portal Web API.
4. Open `/admin` and choose **Import existing content** once. The import preserves existing business record IDs and learning progress, and can resume after a failure without replacing edits. If an active live module has no matching source page in this checkout, the import names it and remains incomplete until its source is included. Only a completed import switches public lists away from the initial content manifest.
5. Perform the acceptance checks below before promoting this package to production. Allow Power Pages to refresh its configuration cache after import and publishing; database success and visible-site refresh are separate checks.

Thereafter the manager works in the dashboard: create or edit, save a draft, preview, and publish. No per-content Power Pages Studio work is intended.

## What Publish writes

| Content | Backend records |
| --- | --- |
| Learning pathway | Existing learning-path table plus private content and published snapshot |
| Training module | Existing module table and pathway lookup, root Web Page and localized Web Page components, private content and published snapshot |
| Agent | Agent card snapshot and a real root/localized detail page; an imported agent keeps its existing module link if present |
| Prompt | Private content and published snapshot, automatically listed and categorised by the Prompt Library |
| Testimony | Existing testimony record and published snapshot, including its selected image URL |
| Image upload | Actual type-3 Power Pages Web File component, uploaded Dataverse file content, and media-library records |
| Ordinary page | Existing root/localized page components, or new ones for a new page, with content rendered from approved sections or imported fields |

Draft content is stored in `crd38_contentitem`; immutable requests and outcomes in `crd38_contentoperation`; public snapshots in `crd38_publishedcontent`. Public reads never require access to draft or operation rows.

The flow stages new page/file components as Draft, uploads image bytes, then commits published page state, business data, public snapshot, and successful operation status together in a Dataverse changeset. Existing live page copy is only changed in that final transaction. Saving a draft leaves the published snapshot intact. Unpublishing keeps learning progress and changes visibility instead of deleting records.

Retries reuse operation IDs. Revision checks and serial route checks reject conflicting saves. Failed publication can leave a nonpublic staged component for the next retry to reuse; the dashboard does not report it as published. A failed image upload can leave an unused draft Web File for platform-owner cleanup.

## Editing boundaries

- New pages use a fixed set of sections: text, callout, cards, steps, image, and knowledge check. Layout, CSS and executable JavaScript stay in source control.
- Existing bespoke pages expose their imported text and link fields while retaining their layout and behavior. Changes to functionality still require a code release.
- Page addresses are fixed after the first save; duplication creates a separate address. This preserves existing links and progress mappings.
- Uploaded images are normalised to JPEG or PNG, at most 1,600 pixels on the longest edge and 500 KiB. Images remain available while published pages may reference them.
- Existing Dataverse column limits are validated before publication. A testimony has 2,000 characters of body and 100 combined tag characters; pathway/module descriptions have 2,000 characters.
- Publishing is serial for consistency. If publishing volume later becomes high, replace the single queue with per-item concurrency and a database uniqueness constraint; do not simply enable parallel runs.

## Tenant acceptance

Use a manager account and an ordinary signed-in account:

1. Import existing content, confirm counts and preserved module/progress IDs, then repeat import and verify no duplicate records.
2. Create a pathway and module with text, an image and a knowledge check. Publish and inspect actual root/localized component IDs, parent, template, language, publishing state and module lookup. Open its real URL and exercise completion.
3. Upload a portrait. Verify the Web File component and nonempty file bytes, its returned URL, image content type, and rendered image. Publish a testimony using it.
4. Publish a prompt with a new category and an agent with a detail page and launch link. Confirm their public cards and links.
5. Change a published item's draft; ordinary users must keep seeing its prior published version. Publish, refresh, then unpublish and confirm it disappears. Ordinary users must be denied AdminHubMaster and private-table access.
6. Retry an ambiguous submission with the same request ID; verify one operation/page. Submit conflicting revisions and the same new page address from two manager sessions; verify one succeeds and the other reports a conflict.
7. Force a publishing failure in development. Confirm failed status, no false success, and the previous published version remains intact. Verify a retry succeeds after resolving the failure.

## Rebuild and local checks

Run from the repository root using the installed Python, Node.js and PAC tools:

```text
python helpers/content-seed.py
node helpers/build-content-server.js
python helpers/build-content-flow.py
node helpers/check-content.js
node helpers/check-server-logic.js
node helpers/check-client-requests.js
node helpers/check-testimonies.js
node helpers/check-breadcrumbs.js
node src/pa-knowledge-hub---knoweldgehub/web-pages/admin-dashboard/check-admin-editor.js
python helpers/build-content-solution.py
```

`check-server-logic.js` includes `check-content-server.js`. The latter uses an in-memory Dataverse substitute; it does not call a tenant. PAC solution unpack and ZIP checks validate packaging, not service execution.

The changeset serialization is based on an [actual exported Power Automate flow](https://github.com/hmcts/ss-pp-cnbc-tasks/blob/4926b74d5503d33956ac9d64ea6a37703d6ffbfd/CNBCTaskManagement/Workflows/Email-CreateTaskwhenGeneralEmailReceivedAutomated-A005632D-A3FD-EF11-BAE2-6045BD11DF63.json). Microsoft documents [changeset transactions](https://learn.microsoft.com/en-us/power-automate/dataverse/change-set) and [server logic table permissions](https://learn.microsoft.com/en-us/power-pages/configure/server-logic-overview).
