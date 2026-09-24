# Connect Hub handoff

## Objective and baseline
- Complete the current root `prompt` against `origin/main`. Pulled through `63aae5a` before editing; the new prompt reports Power Pages validator errors in `TrainingHubMaster` and `AdminHubMaster`, asks to verify solution table names, and restore green header/footer rules.
- `f1ad837` delivered the redesign and site/server logic. `ad85320` fixed the prior data contracts, layout, admin visibility, and created `ConnectHub_1_0_0_8.zip`.

## Completed in editable site source
- Replaced `startsWith(` in training role checks and `function (` sort callbacks in admin logic. These were the text matched by the tenant's prohibited-pattern errors; the existing behavior is preserved.
- Removed stale `crd38_title` and `crd38_moduleid` fallbacks. All `crd38_` names referenced in site JavaScript now match names or entity sets in the solution's `customizations.xml`; the three navigation binding names also occur there.
- Kept the existing green header bottom rule and changed the footer top rule to the same 2px brand green. Added a focused check for the two reported prohibited patterns.

## Checks and artifact status
- `node helpers/check-server-logic.js`, `node helpers/check-client-requests.js`, `node --check` on the changed admin JavaScript and both server scripts, and `git diff --check` pass. A broader local scan found no other documented restricted patterns in the two server scripts.
- `ConnectHub_1_0_0_8.zip` passes ZIP CRC; `solution.xml` says version 1.0.0.8 and `Managed=0`. Its required entity sets and columns are present. The ZIP was not changed in this batch; the Power Pages site source lives separately under `src/`.
- Local Playwright CSS preview rendered the header and footer with `2px solid rgb(139, 197, 63)` rules. This was a temporary local preview, not a live site test.
- No managed release was created or verified. `.playwright-cli/` is unrelated untracked local browser output and remains untouched.

## Tenant work still required
- Authenticate to the intended Power Platform environment; upload the updated Power Pages site source and import the unmanaged solution if not already imported. Verify the tenant accepts both server scripts, inspect live Network responses and Dataverse data/permissions, confirm the intended user's `Administrators` web role, and test admin CRUD, progress, testimonies, and ContactFiller.
- Export a managed release only after those tenant checks pass. No site upload, solution import, server response, flow run, managed export, or live functionality was verified locally.
