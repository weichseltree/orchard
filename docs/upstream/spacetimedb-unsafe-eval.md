# Draft · upstream issue for clockworklabs/SpacetimeDB

Not filed. BACKLOG 11. File it from your own GitHub account when you are
happy with the wording; the numbers below were measured here on 2026-09-12
against `spacetimedb` 2.10.0 (`dist/index.browser.mjs`).

---

**Title:** TypeScript SDK: BSATN serializer codegen uses `Function()`, which
forces `'unsafe-eval'` into every client's Content-Security-Policy

**What happens**

The browser SDK compiles a serializer and a deserializer per row type at
runtime by building JavaScript source and calling `Function(...)`
(`dist/index.browser.mjs` in 2.10.0, lines 1206, 1214, 1253 and 1344:
`Function("writer", "value", body)` and `Function("reader", body)`).

Under a Content-Security-Policy whose `script-src` does not include
`'unsafe-eval'`, the first table subscription throws
`EvalError: Refused to evaluate a string as JavaScript`, inside the
connection's message handling. The connection itself stays open, so the
client sees a connection that never delivers a row and no error at the call
site; ours retried the room join forever with a "connecting" status.

**Why it matters**

A WebXR site (ours: https://www.weichseltree.com/grove/) wants the strictest
CSP it can carry: `script-src 'self' 'wasm-unsafe-eval'` plus `blob:` for
workers. `'unsafe-eval'` re-opens `eval`, `new Function` and string timers
for every script on the page, which is the single biggest relaxation a
policy can make, and it is needed only for this one dependency.

**What would help**

Any of:

1. An interpreted (non-JIT) serializer path, chosen automatically when
   `Function` throws an `EvalError`, or opted into with a flag on the
   builder (`.withoutCodegen()` or similar). The generated code is a
   straight-line sequence of `view.setUint32(...)` calls, so a
   closure-based interpreter over the same algebraic type would be a
   small, cacheable equivalent.
2. Generating the serializers at `spacetime generate` time into the
   `module_bindings`, so the browser runs static code.
3. At minimum, surfacing the `EvalError` on the subscription's `onError`
   and in the connection's error callback, so a strict CSP fails loudly.

**Reproduce**

Serve any client built with the 2.10 SDK behind
`Content-Security-Policy: script-src 'self'`, subscribe to a table with at
least one row. Chromium 141 and Firefox 143 both refuse the `Function()`
call; the subscription's `onApplied` never fires.

**Environment**

`spacetimedb` 2.10.0 (npm), maincloud, Vite 8 build, Chromium 141.
