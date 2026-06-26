# AI 美化 (AI Beautify)

A one-click feature that tidies the current Excalidraw canvas: aligns boxes,
equalizes spacing, snaps to a grid, and unifies stroke width / font family /
font size. The hard spatial reasoning is done by **DeepSeek**; a deterministic
pass guarantees the consistency rules and acts as an offline fallback.

## Flow

```
excalidrawAPI.getSceneElements()
  → extract.ts        compact, model-friendly JSON ({i,t,x,y,w,h,txt?})
  → POST /beautify-api/api/beautify   (beautify-proxy → DeepSeek, or grid-align fallback)
  → merge.ts          apply geometry patch + normalize styles (immutable)
  → excalidrawAPI.updateScene()  (undoable) + scrollToContent()
```

Why a compact representation? The full element JSON carries fields the layout
model does not need (`seed`, `versionNonce`, bindings, …) and can be large. We
send rounded ints + one-letter type codes keyed by array index, then map the
returned patch back by index.

## Modules

| File | Responsibility |
| --- | --- |
| `extract.ts` | scene → compact array (skips deleted/unsupported, keeps indices) |
| `normalize.ts` | deterministic consistency rules (grid snap, font/stroke) |
| `merge.ts` | apply patch + normalize, immutably, validating untrusted numbers |
| `beautify.ts` | orchestration: fetch + updateScene + recenter |
| `seed.ts` | the messy first-visit demo diagram (flash-design-backend) |
| `AIBeautifyButton.tsx` | floating top-right button + bobbing guide bubble |

## Config

`VITE_APP_BEAUTIFY_BACKEND` — proxy base URL. Defaults to same-origin
`/beautify-api` (prod, via nginx); set to `http://localhost:8787` in dev.

## Tests

- `beautify.test.ts` — unit tests for extract/normalize/merge + seed invariants.
- `../tests-e2e/beautify.spec.ts` — Playwright: messy seed loads, click beautifies,
  asserts grid alignment + style consistency on the live scene.
