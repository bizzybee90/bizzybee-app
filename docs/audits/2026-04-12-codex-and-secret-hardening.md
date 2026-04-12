# Codex And Secret Hardening

Date: 2026-04-12
Branch: `codex/supabase-hardening-control`

## Current posture

- Codex MCP config is now trimmed to the high-value set:
  - `playwright`
  - `sentry`
  - `semgrep`
  - `ghActions`
  - `ghCodeSecurity`
  - `ghDependabot`
  - `ghSecretProtection`
- The old `n8n` MCP entry was removed from local Codex config.
- The local machine already has the 1Password CLI installed (`op 2.33.1`).
- A repo scan did **not** find embedded live API keys or passwords in BizzyBee source.
- BizzyBee still references many required runtime secrets through environment variables and Supabase secrets, which is the correct pattern.

## Important app hardening change

Four OAuth state handlers were using `SUPABASE_SERVICE_ROLE_KEY` as a fallback signing secret when `OAUTH_STATE_SECRET` was missing:

- `meta-auth-start`
- `meta-auth-callback`
- `aurinko-auth-start`
- `aurinko-auth-callback`

That fallback has now been removed. These flows now require a dedicated `OAUTH_STATE_SECRET`.

## Recommended secret standard

Use 1Password as the source of truth for human-managed secrets, but do **not** give Codex or other agents broad vault-writing power by default.

Recommended model:

1. Store secrets in 1Password.
2. Inject them into shells or commands only when needed.
3. Keep production write secrets out of everyday AI sessions unless the task truly requires them.
4. Keep GitHub secret scanning and push protection enabled.
5. Keep Supabase function secrets in Supabase, sourced from 1Password when provisioned.

## Recommended operational split

### Safe to expose to read-only AI tooling

- Sentry issue and trace visibility
- Semgrep findings
- GitHub Actions status
- GitHub code scanning results
- GitHub Dependabot findings
- GitHub secret protection findings
- Playwright browser automation

### Do not expose broadly by default

- 1Password vault write access
- Stripe live write keys
- Supabase service-role keys
- Twilio auth token
- Aurinko client secret
- Anthropic/OpenAI production keys
- ElevenLabs live API keys

## 1Password usage recommendation

Prefer per-process secret injection instead of global shell export.

Good:

- `op run -- your-command`
- `op read op://vault/item/field`

Avoid:

- long-lived global exports in dotfiles
- pasting secrets into Codex config files
- committing filled `.env` files

## Remaining required secrets to provision and track

BizzyBee still relies on environment-backed secrets including:

- `OAUTH_STATE_SECRET`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY`
- `OPENAI_API_KEY`
- `AURINKO_CLIENT_ID`
- `AURINKO_CLIENT_SECRET`
- `AURINKO_WEBHOOK_SECRET`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_SMS_NUMBER`
- `TWILIO_WHATSAPP_NUMBER`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_WEBHOOK_SECRET`
- `GOOGLE_BUSINESS_WEBHOOK_TOKEN`
- `GDPR_TOKEN_SECRET`
- `POSTMARK_API_KEY`

These should live in 1Password as the human-owned source of truth, and be provisioned into Supabase/function environments from there.

## Conclusion

The repo is in a healthier place than it first appears:

- no live secrets embedded in code were found in this pass
- Codex is trimmed toward read-only security tooling
- the biggest local hardening issue found in app code was the OAuth signing-secret fallback, and that is now removed

The next security step is not adding more MCPs. It is:

1. create the 1Password items for the required secret inventory
2. provision `OAUTH_STATE_SECRET` everywhere the OAuth flows need it
3. keep secret scanning and code scanning active
4. run the security MCPs regularly as part of release hardening
