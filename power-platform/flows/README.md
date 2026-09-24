`ContactFiller.flow.json` is the editable flow source. It changes the Office 365 profile lookup to use the Entra user ID returned by `Get_user`, which remains available when `mail` is blank.

`ConnectHub_1_0_0_8.zip` is an unmanaged solution package with this flow revision. It does not contain the separate Power Pages site source under `src/`. Import and test the unmanaged solution in the intended environment, upload the site source separately, then export a managed release when tenant checks pass.
