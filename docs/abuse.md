Blocking a specific abuser

For "I have his IP, ban him":

- IP Access Rules (dashboard: Security → WAF → Tools). Block a
  single IP, a CIDR range, a whole ASN (useful when the abuser
  is a hosting provider's VM — block the datacenter, not one
  IP), or a country. Available on the free plan, can apply to
  one zone or your whole account.
- WAF custom rules (Security → WAF → Custom rules).
  Expression-based, e.g. ip.src eq 203.0.113.7 or ip.src in
  {…list…} → Block. More flexible than IP Access Rules: you can
  scope to a hostname (http.host eq "extractor.brace.to") or path,
  so you can ban someone from the extractor but not the API.

The key economic point: a WAF block happens before the Worker
is invoked, so a blocked abuser costs you zero Worker
requests, zero rate-limit binding checks, zero D1/R2 ops.
Checking a blocklist inside the Worker (KV lookup on
cf-connecting-ip) also works but still bills a request per hit
— use it only if you need per-user rather than per-IP logic.

To find the IP in the first place: the Security → Events log
shows WAF matches, but your in-Worker 429s aren't WAF events —
so it's worth logging cf-connecting-ip when the limiter
denies (aggregate IP + count is fine even for the extractor;
the "never log" rule there is about the URL, not the IP).
wrangler tail or the observability binding surfaces it.

One caution: don't reach for Managed Challenge / Bot Fight
Mode on these two hostnames. They're APIs called by fetch from
the web app and the extension — a challenge page just breaks
your own clients. Block and rate-limit are the right actions
here.

The gap your question actually points at: under-the-limit
sustained abuse

This is real. Your in-Worker limits only bound rate, not
volume: 10 req/10s on /v1/extract still allows ~86,000 extract
calls/day from one IP, each fanning out to 20 URL fetches —
forever, without ever seeing a 429. Things I'd do, in priority
order:

1. Zone-level Rate Limiting Rules with long windows (Security
   → WAF → Rate limiting rules). This is the complement your
   native bindings can't express: the binding only does 10s/60s
   windows, but WAF rate limiting supports longer periods and —
   importantly — a block duration, e.g. "more than N requests to
   extractor.brace.to in an hour → block that IP for a day." That
   converts "stranger politely hammering under the limit" into an
   automatic ban with no code. This is the single most direct
   answer to your scenario.
2. Billing alarms. Cloudflare has no hard spend cap on Workers
   paid plans, so set up Notifications (dashboard:
   Notifications) for Workers usage / billable-usage thresholds,
   plus a weekly glance at the Workers analytics per-service
   request graph. An abuse pattern shows up there before the
   invoice does.
3. Account creation is your other anonymous endpoint. POST
   /auth/account is tight-limited per IP, but that still permits
   thousands of accounts/day from one IP, each with its own
   storage quota. Consider a much harsher WAF rate-limit rule on
   that path specifically (e.g. a handful per hour per IP with a
   long block), since no honest user creates more than a couple
   of accounts.
4. The extractor's documented upgrade — your own architecture
   notes already name it: blind capability tokens (Privacy Pass)
   so only real users of your apps can call it, without tying
   URLs to accounts. Cloudflare Turnstile is the pragmatic
   near-term version: the web app solves an invisible challenge
   once, gets a short-lived token, sends it with extract calls,
   and the Worker verifies it. That closes the "anonymous
   stranger" hole entirely rather than just pacing it. Worth
   doing before the extractor gets real traffic.
5. Per-user keying on the remaining brace-api routes (minor):
   ops/list and files/list are IP-keyed only, so an authed abuser
   rotating IPs multiplies their quota. You already key
   sign/commit per user; the same userRateLimitKey on the list
   endpoints closes that for a stranger who does have an account.

Also for perspective on the cost ceiling: your worst-case
surfaces are Workers requests (cheap — ~$0.30 per million), D1
row ops, and R2 class-A ops; R2 egress is free, and the
extractor's outbound fetches aren't billed as bandwidth. So
the realistic "explosion" scenario isn't one stranger under
the limit (that's dollars per month at your current tiers) —
it's either many IPs (botnet, which WAF rate-limiting + ASN
blocks handle) or storage-quota abuse via mass account
creation (#3). The pieces above cover both, and #1 + #2 are
dashboard-only — no code changes needed.
