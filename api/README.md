# `api/` — Vercel serverless functions

## Why there is a `package.json` here

It contains one field, `{"type": "commonjs"}`, and it is load-bearing.

The root `package.json` declares `"type": "module"` for the Vite app. Vercel compiles
every `api/**/*.ts` file and uses the *nearest* `package.json` to decide the output
module format, so without this file the functions were emitted as ESM — and Node's ESM
resolver requires an explicit file extension on every relative import:

```
import { getStripe } from '../_lib/stripe';   // ERR_MODULE_NOT_FOUND under ESM
```

The failure is at module load, before the handler runs, so Vercel returns its own
`FUNCTION_INVOCATION_FAILED` page rather than anything the handler could catch. It hit
every function with a relative import — all three Stripe endpoints and `send-invite` —
while the import-free handlers next to them kept working, which is what made it look
like a Stripe problem.

Bare specifiers (`'stripe'`, `'@supabase/supabase-js'`) always resolved; only relative
ones broke.

The alternative fix is adding `.js` extensions throughout, but the graph reaches into
`src/lib/email` and `src/lib/i18n`, which Vite compiles under bundler resolution where
those extensions do not belong. CJS keeps the two build targets from fighting.
`src/lib/i18n/translate.ts` already carries a comment forbidding `import.meta` for
exactly this reason, so CJS emission is what the code was written against.

## Rules

- Nothing here may import from `src/` except pure, browser-free modules — these files
  read `process.env` secrets that must never reach the client bundle.
- Never prefix a secret with `VITE_`; that compiles it into the browser bundle.
- Anything reachable from here must stay free of `import.meta`: it is a *parse* error
  under CJS, not something a runtime guard can catch.
