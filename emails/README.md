# Resend authentication email setup

The app uses Supabase to generate and verify account tokens. The signed Send Email hook delivers signup and password recovery emails through Resend, using templates you publish there. No second email is sent by the app or Supabase SMTP when the hook is enabled.

## Publish the templates in Resend

Create two templates and import/paste the HTML from `signup-verification.html` and `password-recovery.html`. Define one custom string variable in each: `ACTION_URL`, with no fallback. Both HTML files use Resend's `{{{ACTION_URL}}}` syntax. Publish each template and copy its ID into the corresponding environment variable below. Subjects are supplied by the app: “Verify your email to join Darwin” and “Reset your Darwin password”.

## Configure the deployed app

Set these server environment variables (never prefix secrets with `NEXT_PUBLIC_`):

```dotenv
RESEND_API_KEY=your-resend-api-key
RESEND_AUTH_FROM=Darwin <noreply@your-verified-domain>
RESEND_SIGNUP_TEMPLATE_ID=published-signup-template-id
RESEND_RECOVERY_TEMPLATE_ID=published-recovery-template-id
SEND_EMAIL_HOOK_SECRET=v1,whsec_your-supabase-hook-secret
NEXT_PUBLIC_SITE_URL=https://your-deployed-darwin-domain
```

Use a sender on a verified Resend domain. The current sender fallback is `Darwin <noreply@vesperworks.ca>`, matching existing app emails.

In Supabase Authentication → Hooks, create an HTTPS Send Email hook pointing to `https://your-deployed-darwin-domain/api/auth/send-email`. Generate/copy the hook signing secret into `SEND_EMAIL_HOOK_SECRET`. Deploy the app with these variables before enabling the hook. Keep the Email auth provider and email confirmation enabled. Set Supabase Site URL to the same origin as `NEXT_PUBLIC_SITE_URL`; allow `https://your-deployed-darwin-domain/auth/callback` in Redirect URLs (and localhost for local testing).

The hook currently supports this app's `signup` and `recovery` email actions. Other actions (such as email changes, invitations, or magic links) return an error; add templates/handling before enabling those flows. Existing waitlist and membership emails are unaffected.

## Verify after deployment

1. Sign up with a new supported school email. Check that the verification popup appears and Resend records exactly one email using the signup template.
2. Follow its link: it should verify the account and open the requested app page. Reusing the link should fail.
3. Use “Forgot your password?” from `/login` (or the profile password reset control). The recovery email should use the other template.
4. Follow its link to `/reset-password`, save a password meeting the displayed requirements, then sign in with it.
5. Confirm expired links are rejected and unsupported email domains remain blocked during onboarding.

Local tests cover signed payload verification, tampering/expired signatures, template routing, safe redirects, password validation, and provider error handling. Live delivery requires publishing templates and enabling the hook in your accounts.

References: https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook and https://resend.com/docs/dashboard/templates/template-variables
