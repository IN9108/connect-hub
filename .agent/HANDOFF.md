# Connect Hub handoff

## Objective
Complete the current root `prompt` against `origin/main`: keep light mode as the default, fix the reported layout issues, restore working data and admin access, and update the solution flow where needed.

## Completed in source
- Earlier commit `f1ad837` supplied the redesign, dark mode, caching, admin CRUD, server logic, role-scoped progress, and the editable ContactFiller flow correction.
- Pulled `origin/main` to `44d59ad` before this batch. The current prompt and a newer unmanaged `ConnectHub_1_0_0_7.zip` arrived in the two commits after `f1ad837`.
- Made light the default while keeping saved dark preference; fixed the shared background attachment, dark agent-step hover, testimony tag clipping/fades, prompt card width and low-contrast prompt submission copy.
- Unhid the admin page and activated its existing web link. The page access rule and server logic remain restricted to the `Administrators` web role.
- Matched testimony image and paragraph code to the solution's actual `crd38_imageurl` and `crd38_paragraphs` columns. Added visible home/admin load errors and a JSON request body for training POSTs.
- Created `ConnectHub_1_0_0_8.zip` as an **unmanaged** package from 1.0.0.7. Only the solution version and ContactFiller workflow changed; the workflow now matches `power-platform/flows/ContactFiller.flow.json`.

## Checks
- `node helpers/check-server-logic.js` and `node helpers/check-client-requests.js` pass; changed JavaScript passes `node --check`; `git diff --check` passes.
- Solution ZIP CRC and changed-entry comparison pass; `pac solution unpack` succeeds. Testimony field names were checked against `customizations.xml`.
- Local Playwright preview checked light default under dark OS preference, theme toggle, fixed background, two-column desktop/one-column mobile prompt grid, prompt search/copy, dark agent hover, and testimony tags. These are local previews.

## Unverified / exact next action
- No PAC authentication profile exists on this machine. No site upload, solution import, Dataverse data/role assignment, server response, cloud-flow run, or live Power Pages interaction was verified. `ConnectHub_1_0_0_8.zip` contains solution components, not the separate Power Pages site source under `src/`, and is not a managed release.
- Authenticate to the intended development environment; upload the site source and import the unmanaged package. Inspect live Network responses for `TrainingHubMaster` and `AdminHubMaster`, verify the user's `Administrators` web role, table permissions and data, then test admin CRUD, progress, testimonies and ContactFiller. Export a managed release only after those tenant checks pass.
