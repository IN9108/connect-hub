# Connect Hub handoff

## Objective and baseline
- Complete the root `prompt` against latest `origin/main`, pulled through `1479821` before editing. It reports card accent fragments, missing header rule/admin link, repeated Home and Training loading, mismatched footer shade, and only a test testimony in the live page.
- `f1ad837` delivered the redesign and site/server logic. `ad85320` fixed earlier data contracts and layout and added the unmanaged `ConnectHub_1_0_0_8.zip`. `580cd4d` fixed Power Pages validation patterns and the prior header/footer CSS.

## Editable site source completed
- Removed the short card accent pseudo-element. Raised header rule specificity above the theme's `.static-top` border reset. Matched footer background to the header. Rendered an explicit `/admin` navigation link for the Power Pages `Administrators` role while skipping the dynamic duplicate.
- Home and Training now share the Home-context dashboard cache for 15 minutes, keeping Home's path-dependent current module. A warm Home cache hides its overlay at DOM ready. Forced refresh still fetches fresh data.
- Testimonies combine the published JSON stories with live Dataverse stories by name and discard the known `test`/`test` placeholder. Published stories remain visible if the live endpoint fails.
- Changed files: `web-files/shared.css`, `web-files/shared.js`, Home and AI Testimonies localized JavaScript, `web-templates/header/Header.webtemplate.source.html`, `helpers/check-client-requests.js`, `helpers/check-testimonies.js`, and this handoff.

## Checks and artifacts
- `node helpers/check-client-requests.js`, `node helpers/check-server-logic.js`, `node helpers/check-testimonies.js`, `node --check` on changed JavaScript, and `git diff --check` pass.
- Local Playwright preview showed a 2px green header rule, matching `rgb(16, 25, 25)` header/footer backgrounds, no card accent fragments, no 390px horizontal overflow, and 13 distinct published stories. The preview uses local files and mocked server access.
- `ConnectHub_1_0_0_8.zip` remains unchanged; ZIP CRC passes and `solution.xml` says version `1.0.0.8`, `Managed=0`. No managed release was created or verified. `.playwright-cli/` remains unrelated and untouched.

## Tenant work still required
- Upload the updated editable Power Pages site source in the intended environment and confirm the exact user's `Administrators` web role, visible nav link, page access, header/footer, Home/Training cache behavior, and testimonies with live Network responses and Dataverse records.
- Import the unmanaged solution if needed, test admin CRUD, progress and ContactFiller in the tenant, then export a managed release after acceptance. No site upload, solution import, server response, flow run, managed export, or live functionality was verified locally.
