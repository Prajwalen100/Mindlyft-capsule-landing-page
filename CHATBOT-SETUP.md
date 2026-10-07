# MindLyft AI Agent — setup & deployment

Embeddable chat widget (HTML/CSS/vanilla JS) + Cloudflare Worker backend that calls the DeepSeek API.

```
chatbot/widget.css   → widget styles
chatbot/widget.js    → widget logic (UI, flow, lead capture, sounds, fallback)
worker/worker.js     → POST /api/chat (DeepSeek) + POST /api/lead (Formspree)
worker/wrangler.toml → Cloudflare config
```

## Environment variables

| Name | Where | Required | Purpose |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | Worker secret | ✅ | DeepSeek API key (never put it in the frontend) |
| `DEEPSEEK_MODEL` | Worker var | – | defaults to `deepseek-v4-flash` (`deepseek-chat` was retired in July 2026) |
| `FORMSPREE_URL` | Worker var | – | defaults to `https://formspree.io/f/mnpjpvzb` |
| `FACTS_JSON` | Worker secret | – | owner-confirmed facts (see below) |
| `ALLOWED_ORIGIN` | Worker var | – | lock CORS to your site origin |

## 5-step deployment

1. **Get a DeepSeek key** — create one at <https://platform.deepseek.com>. Keep it secret.
2. **Deploy the worker**
   ```bash
   cd worker
   npx wrangler login
   npx wrangler secret put DEEPSEEK_API_KEY        # paste the key
   # optional facts (only what the owner has confirmed — leave anything out to stay honest):
   # npx wrangler secret put FACTS_JSON
   #   {"batch_start_dates":"Next batch: 10 Nov 2026","class_timings":"7–9 PM IST","prices_include_gst":"Yes, incl. GST"}
   npx wrangler deploy
   ```
   Note the URL, e.g. `https://mindlyft-agent.<you>.workers.dev`.
3. **Point the widget at the worker** — in `index.html`, set `apiBase` in `MindlyftChatConfig` to `https://mindlyft-agent.<you>.workers.dev/api`. (Same-origin `/api` works if you proxy through your host.)
4. **Publish the site** — push to `main` (GitHub Pages or your host). The widget loads from `chatbot/` on every page of the site, fixed at bottom-right while scrolling.
5. **Smoke test** — open the site, tap the brain button, ask "What's the price?", confirm the Early Bird card shows ₹2,999 struck / ₹2,499 highlighted, then send an email + phone and confirm the lead arrives in Formspree.

## Widget config (`window.MindlyftChatConfig`)

```js
{
  apiBase: '/api',                 // worker URL + /api
  logo: 'mindlyftai_logo.avif',    // bot avatar + header logo
  privacyPolicyUrl: '#',           // consent dialog link
  earlyBirdEndDate: '',            // [EARLY_BIRD_END_DATE] — '' ⇒ "Special offer", no deadline
  seatsLeft: '',                   // [SEATS_LEFT] — '' ⇒ never mention scarcity
  phone: '+91 9975670303',
  email: 'info@mindlyftai.com'
}
```

## FACTS_TO_CONFIRM (fill via `FACTS_JSON`, one by one)

`batch_start_dates`, `class_timings`, `certificate_details`, `refund_policy_summary`,
`emi_or_instalments`, `prices_include_gst`, `deadline_or_seats`, `placement_support_features`

Anything you leave out, the bot answers with **"I'll check with the team"** and offers a callback — it never invents facts.

## Pricing rules (enforced in the system prompt *and* the backend)

- ₹2,999 list price, **₹2,499 Early Bird — the absolute floor**. The backend rewrites any reply that shows a lower price or reveals that a minimum exists.
- No deadline/seat scarcity unless confirmed in `FACTS_JSON`.
- Placement support is described as **guidance only** — never a job guarantee.

## Notes

- **Fallback mode:** if the Worker is unreachable (or not configured yet), the widget runs a built-in scripted flow — greeting → profile questions → course recommendation → Early Bird price card → lead capture — so the page always demos well.
- **Sounds** use the Web Audio API (0 KB downloads), default on, mutable in the header (remembered), silent under `prefers-reduced-motion`, when the tab is hidden, and on mobile except bot replies.
- **Spam control:** one Formspree submission per session, hidden `_gotcha` honeypot, 20 chat messages/min and 5 leads/min per visitor, rate limiting + validation in the Worker.
- **Leads** go to Formspree form `mnpjpvzb` with: name, email, phone, course_recommended, agreed_price, coding_level, goal, role, conversation_summary (3 lines), page_url, timestamp.
