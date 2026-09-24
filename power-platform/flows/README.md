`ContactFiller.flow.json` is an editable copy of the flow in `ConnectHub_1_0_0_6_managed.zip`. It changes the Office 365 profile lookup to use the Entra user ID returned by `Get_user`, which remains available when `mail` is blank.

The checked-in managed ZIP is unchanged. Apply this flow revision in the source Power Platform solution before exporting a new managed release.
