---
title: College single sign-on
description: "Students and staff sign in with their college account (Microsoft 365, Google Workspace, Okta or any OpenID Connect provider), becoming members as they do."
glance:
  who:
    - role: Owner and admin
      note: connect the college's identity provider
    - role: Platform staff
      note: confirm which email domains the college owns
  where:
    path: /orgs/<slug>/manage/sso
    menu: "School › Single sign-on"
  permissions: [org.settings.manage, platform.orgs.manage]
---

## Before you start: prove your domains

Single sign-on only signs in addresses on domains your college has proved it owns, so no one can
sign in someone else's address. Under **School › Single sign-on › Your email domains**:

1. Type a domain (for example `college.edu`) and press **Add**.
2. GretLab shows a DNS record to add where your domain's records are managed (your DNS host:
   GoDaddy, Cloudflare, your IT team): type **TXT**, name `_gretlab-challenge.college.edu`, and a
   value starting `gretlab-verify=`. Each has a Copy button.
3. Once it's added, press **Verify**. DNS changes can take a few minutes, sometimes longer; Verify
   says when the record isn't there yet.

Public mail such as gmail.com can't be claimed, and a domain another organization has verified
can't be claimed again. Removing your last domain switches single sign-on off. Each step is in your
activity log. Platform staff can also set domains for you under **Admin › Organizations › SSO
domains**.

## Connecting your identity provider

1. In your identity provider (Microsoft Entra, Google Workspace, Okta, Keycloak…), register an
   OpenID Connect web app. Give it the **Redirect address** shown under **School › Single
   sign-on**, and allow the `openid`, `email` and `profile` scopes.
2. Back in GretLab, enter its **Issuer** (Microsoft's looks like
   `https://login.microsoftonline.com/<tenant>/v2.0`), the **Client ID** and the **Client secret**.
   GretLab reads the provider's published settings and refuses an issuer that doesn't match them.
   The secret is stored encrypted and never shown again.
3. Switch it **On** and save. Saving asks for a fresh two-factor code if you use two-factor.

## Signing in

People choose **Sign in with your college** on the sign-in page and enter their college email.
Their college's sign-in page opens; once they're through, GretLab checks the sign-in's signature,
that it was meant for GretLab, isn't old or replayed, and that the address is on one of your
domains. They're then signed in, made an active member of your organization (new accounts are
made as needed, within your plan's limits), and asked for their two-factor code if they use one.

## Requiring it

**Require it** means addresses on your domains can only sign in through your college: GretLab
passwords, sign-up and password resets are refused for them, and so is Google sign-in unless your
identity provider is Google itself.

## Edge cases

- Signing in is logged in your activity log, as are changes to these settings (the secret only as
  "changed").
- A sign-in can only finish in the browser that started it, within ten minutes, once.
- Taking every domain away switches single sign-on off.
- SAML-only systems aren't supported yet.
