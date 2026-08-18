# `api/` — Vercel serverless functions

## Relative imports must carry a `.js` extension

Vercel does **not** bundle these files. It transpiles each `.ts` to a `.js` and leaves
the import statements exactly as written, then Node loads the result. The root
`package.json` declares `"type": "module"`, so Node loads them as ESM — and the ESM
resolver requires an explicit extension on every relative specifier:

```ts
import { getStripe } from '../_lib/stripe';      // ERR_MODULE_NOT_FOUND
import { getStripe } from '../_lib/stripe.js';   // correct
```

TypeScript maps `'./x.js'` back to `./x.ts`, and Vite resolves it the same way, so the
one spelling works for the type-checker, the app build and the deployed function.

This applies transitively. Anything reachable from `api/` needs extensioned relative
imports too, which is why `src/lib/email/*` and `src/lib/i18n/{translate,fr}.ts` carry
them while the rest of `src/` does not — those four files are in the graph that
`send-invite` pulls in. Adding a plain relative import anywhere in that chain breaks the
function at load time, with nothing in the handler able to catch it.

### What this looked like when it was wrong

Vercel serves its own `FUNCTION_INVOCATION_FAILED` page, because the throw happens at
module load before the handler exists. Every function with a relative import died — all
three Stripe endpoints and `send-invite` — while the import-free handlers beside them
answered normally, which made it read as a Stripe problem rather than a build one.

A previous attempt added `api/package.json` with `{"type": "commonjs"}` on the theory
that Vercel was compiling to CJS. It is not: the emitted file still contains `import`
statements, so forcing a CJS parser produced `SyntaxError: Cannot use import statement
outside a module`. Do not reintroduce that file.

## Rules

- Relative imports need `.js`. Bare specifiers (`'stripe'`, `'@supabase/supabase-js'`)
  do not — the node_modules resolver handles those.
- No `@/*` path aliases. There is no bundler here to expand them.
- Nothing may import from `src/` except pure, browser-free modules — these files read
  `process.env` secrets that must never reach the client bundle.
- Never prefix a secret with `VITE_`; that compiles it into the browser bundle.
- Anything reachable from here must stay free of `import.meta` if it is also consumed by
  a CJS path — see the note in `src/lib/i18n/translate.ts`.
