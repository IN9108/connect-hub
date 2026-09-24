# Connect Hub handoff

## 2026-09-24 review pass
- Objective: apply the website review in the attached goal objective: cached loading behavior, skeletons, card and contrast polish, centered pages, breadcrumbs and theme control, quiz navigation, and speed.
- Completed in editable source: warm Home/Training cache hides initial loading UI; Home, Training and Testimonies use skeletons when data is cold; testimony JSON and live reads run together. Shared header has dynamic breadcrumbs, Admin at the right before the icon theme toggle, and light remains the default. Agent and training layouts are centered; dark card/button text and active navigation hover have explicit contrast; decorative hero labels were removed. Quiz completion panels gain Return to top. Training progress saves no longer make a redundant full dashboard request before navigation; server update queries one path and one contact/module progress record.
- Changed areas: `web-files/shared.js`, `web-files/shared.css`, `server-logic/TrainingHubMaster.js`, localized Home/Training/Agents/Testimonials/Admin/Prompt Library page source, header template, and focused check helpers. Preserve unrelated `.playwright-cli/`.
- Checks: `rtk node helpers/check-client-requests.js`, `rtk node helpers/check-server-logic.js`, `rtk node helpers/check-testimonies.js`, `rtk node --check` on changed client JS, and `rtk git diff --check` pass. Static local Playwright preview checked Agents, QA and Training at 1280/390 in light/dark; no observed overflow. This was not a tenant render.
- Unverified: live Power Pages upload/render, Dataverse response times, admin CRUD and assigned web role. `AdminHubMaster` endpoint and table permissions grant `Administrators`; the separate `Admin` role does not. Confirm the intended admin account's actual role before tenant testing. No tenant deployment or managed solution release was performed.
- Next action: upload editable source to the intended development tenant when authorized, inspect live Network timings and cache behavior, exercise admin create/update/delete and module completion with a test account, then decide whether more profiling or query changes are needed.

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
