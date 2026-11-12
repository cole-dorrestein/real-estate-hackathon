# Phone dispatch server

Run from the repository root with Node 22:

```sh
npx tsx server/dispatch.ts
```

Configure `.env.local` (gitignored):

```text
GROKBOT_WEBHOOK_URL=
GROKBOT_WEBHOOK_KEY=
DISPATCH_PHONE_NUMBER=
DISPATCH_CALLBACK_BASE_URL=
DISPATCH_STATUS_DIR=
DISPATCH_ALLOWED_ORIGINS=
```

Set `DISPATCH_PHONE_NUMBER` in E.164 format. Every new dispatch sends `channel: phone` and that destination to the Grok Bot webhook; contractor email is never selected by the dispatch endpoint. The webhook's success response confirms that the request was accepted, not that the call rang or was answered. Configure Grok Bot to use Speko to place the call. A click on **Call my phone** initiates the request after triage.

The server listens on port 8787. It validates browser origins, sends the webhook key only from the server, and keeps job state in the gitignored `server/dispatch-jobs.json`. A failed request is logged in the gitignored `server/dispatch-failed.jsonl`. The frontend stores matters and photos in browser local storage; photos embedded as data URLs are not sent to the webhook.

For automatic status updates, make the callback server reachable by Grok Bot and set `DISPATCH_CALLBACK_BASE_URL` to that public origin. Each dispatch then includes a callback URL and per-job token. The remote workflow can POST `contacted`, `visit_agreed`, or `failed` to the supplied URL with the token as a Bearer token or `X-Status-Token`. Without a reachable callback or a shared `DISPATCH_STATUS_DIR`, a successful request stays in **Call requested**; it is not evidence of a completed call. Restrict access to any tunnel exposing the server.
