// DeepSeek beautify proxy. Zero external deps (Node >=18, global fetch).
//
// Holds the DeepSeek API key server-side. Frontend POSTs compact elements;
// proxy asks DeepSeek (flash) for an aligned layout patch and returns it.
// If no key (or model fails / hangs), falls back to a deterministic grid-align
// so the demo and e2e always succeed.
//
// Env: DEEPSEEK_API_KEY, DEEPSEEK_BASE_URL (default https://api.deepseek.com),
//      DEEPSEEK_MODEL (default deepseek-chat), PORT (default 8787),
//      ALLOWED_ORIGIN (CORS allow-list; default "*"), RATE_LIMIT_PER_MIN (default 20)
import { createServer } from "node:http";

const PORT = Number(process.env.PORT || 8787);
const KEY = process.env.DEEPSEEK_API_KEY || "";
const BASE = (
  process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com"
).replace(/\/$/, "");
const MODEL = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const RATE_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_PER_MIN || 20);

const GRID = 20;
const MAX_BODY_BYTES = 200_000; // ~a few thousand compact elements; plenty for any real diagram
const MAX_ELEMENTS = 500;
const VALID_TYPES = new Set(["r", "t", "a"]);
// deepseek-v4-flash over-reasons past ~10 elements (never emits the answer), so
// we send small chunks in parallel and stitch the patches back together.
const CHUNK_SIZE = Number(process.env.BEAUTIFY_CHUNK_SIZE || 4);
// Per-chunk model timeout. Chunks usually finish in 7-15s; a straggler that
// over-reasons is aborted here and falls back to the deterministic align, so
// total latency stays bounded instead of waiting out the worst chunk.
const CHUNK_TIMEOUT_MS = Number(process.env.BEAUTIFY_CHUNK_TIMEOUT_MS || 10_000);

// Only call the model over https to a trusted host; otherwise force fallback so
// the API key can never be sent to a misconfigured / internal endpoint (SSRF).
const ALLOWED_MODEL_HOSTS = [/(^|\.)deepseek\.com$/, /(^|\.)aliyuncs\.com$/];
const modelEnabled = (() => {
  if (!KEY) {
    return false;
  }
  try {
    const u = new URL(BASE);
    if (u.protocol !== "https:") {
      console.error(
        "DEEPSEEK_BASE_URL must be https — disabling model, using fallback",
      );
      return false;
    }
    if (!ALLOWED_MODEL_HOSTS.some((re) => re.test(u.hostname))) {
      console.error(
        `DEEPSEEK_BASE_URL host ${u.hostname} not allow-listed — disabling model`,
      );
      return false;
    }
    return true;
  } catch {
    console.error(
      "DEEPSEEK_BASE_URL invalid — disabling model, using fallback",
    );
    return false;
  }
})();

// Kept concise on purpose: deepseek-v4-flash is a reasoning model and a verbose
// rubric makes it over-think and blow the token budget before answering.
const SYSTEM_PROMPT = `These excalidraw elements use small integer grid coordinates. Each item: {i,t,x,y,w,h} (i=index, t="r" box / "t" text, x,y=top-left, w,h=size, all small integers).
Tidy the layout: give boxes in the same column the same x; use equal vertical gaps between stacked boxes; keep each text near the box it labels; do not overlap, reorder, add or remove elements.
Output ONLY JSON {"patch":[{"i":int,"x":int,"y":int,"w":int,"h":int}]}, one entry per input element, same order, integers only. No prose.`;

// ── per-IP sliding-window rate limiter ──────────────────────────────────────
const hits = new Map(); // ip -> number[] (timestamps ms)
const rateLimited = (ip) => {
  const now = Date.now();
  const windowStart = now - 60_000;
  const arr = (hits.get(ip) || []).filter((t) => t > windowStart);
  arr.push(now);
  hits.set(ip, arr);
  if (hits.size > 5000) {
    // bound memory: drop the oldest-ish entries
    for (const k of hits.keys()) {
      if (hits.get(k).every((t) => t <= windowStart)) {
        hits.delete(k);
      }
    }
  }
  return arr.length > RATE_LIMIT_PER_MIN;
};

const clientIp = (req) =>
  (req.headers["x-forwarded-for"] || "").toString().split(",")[0].trim() ||
  req.socket.remoteAddress ||
  "unknown";

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(
        Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }),
      );
      req.destroy();
      return;
    }
    let data = "";
    let done = false;
    req.on("data", (c) => {
      if (done) {
        return;
      }
      data += c;
      if (data.length > MAX_BODY_BYTES) {
        done = true;
        reject(
          Object.assign(new Error("payload too large"), { code: "TOO_LARGE" }),
        );
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!done) {
        resolve(data);
      }
    });
    req.on("error", (e) => {
      if (!done) {
        reject(e);
      }
    });
  });

// Validate + sanitize one compact element. Drops `txt` entirely: the layout
// model only needs geometry, and forwarding free text invites prompt injection.
const sanitizeElement = (el) => {
  if (!el || typeof el !== "object") {
    return null;
  }
  const i = el.i;
  if (!Number.isInteger(i) || !VALID_TYPES.has(el.t)) {
    return null;
  }
  const nums = ["x", "y", "w", "h"].map((k) => Number(el[k]));
  if (nums.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [x, y, w, h] = nums;
  return { i, t: el.t, x, y, w, h };
};

const snap = (n) => Math.round(n / GRID) * GRID;

// Deterministic tidy: snap everything to the grid and align boxes that fall in
// the same coarse column to a shared x — guarantees "borders that should align,
// align" globally regardless of which chunk the model placed them in. Input
// items carry {i,t,x,y,w,h}; output is the patch [{i,x,y,w,h}].
const columnAlign = (items) => {
  const boxes = items.filter((e) => e.t === "r");
  const colOf = (x) => Math.round(x / 80);
  const cols = new Map();
  for (const b of boxes) {
    const k = colOf(b.x);
    if (!cols.has(k)) {
      cols.set(k, []);
    }
    cols.get(k).push(b);
  }
  const colX = new Map();
  for (const [k, arr] of cols) {
    const xs = arr.map((b) => b.x).sort((a, b) => a - b);
    colX.set(k, snap(xs[Math.floor(xs.length / 2)]));
  }
  return items.map((e) => {
    const x =
      e.t === "r" && colX.has(colOf(e.x)) ? colX.get(colOf(e.x)) : snap(e.x);
    return { i: e.i, x, y: snap(e.y), w: snap(e.w), h: snap(e.h) };
  });
};

const chunk = (arr, size) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) {
    out.push(arr.slice(i, i + size));
  }
  return out;
};

// deepseek-v4-flash is a REASONING model: `response_format: json_object` makes
// it return empty content, and reasoning burns a lot of completion tokens, so
// max_tokens must be generous. We parse JSON out of the plain text response.
const extractJson = (content) => {
  const text = String(content || "").trim();
  // strip ```json … ``` fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) {
    throw new Error("no JSON object in model output");
  }
  return JSON.parse(body.slice(start, end + 1));
};

const callDeepSeek = async (elements) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CHUNK_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: JSON.stringify(elements) },
        ],
        temperature: 0,
        // generous headroom: the reasoning pass alone can use ~1.5k tokens for
        // a 5-element chunk, and hitting the cap mid-reason yields empty output
        max_tokens: Math.min(6000, elements.length * 400 + 2500),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      console.error("deepseek upstream error", res.status, detail);
      throw new Error("upstream model error");
    }
    const data = await res.json();
    const parsed = extractJson(data?.choices?.[0]?.message?.content);
    if (!Array.isArray(parsed.patch)) {
      throw new Error("no patch array in model output");
    }
    return parsed.patch;
  } finally {
    clearTimeout(timer);
  }
};

// Ask DeepSeek for the layout in small parallel chunks; any chunk that fails or
// times out falls back to the deterministic align for just that chunk, so a
// single slow call never sinks the whole request. Returns a {i,t,x,y,w,h} array
// (model x/y/w/h merged over the originals) ready for the final columnAlign.
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);

const modelLayout = async (elements) => {
  // Arrows carry their own point geometry; moving their bounding box via the
  // model just adds noise and reasoning load. Send only boxes + text to the
  // model; arrows are grid-snapped by the deterministic columnAlign pass.
  const forModel = elements.filter((e) => e.t === "r" || e.t === "t");
  const passthrough = elements.filter((e) => e.t === "a");
  if (!forModel.length) {
    return elements;
  }

  // Normalize to small, origin-shifted GRID units before sending. The model
  // then does plain small-integer alignment instead of arithmetic on raw pixel
  // coords (217 → snap-to-220 …), which cuts both the prompt size and the
  // amount of reasoning. We denormalize the result back to absolute pixels.
  const ox = Math.min(...forModel.map((e) => e.x));
  const oy = Math.min(...forModel.map((e) => e.y));
  const toUnit = (e) => ({
    i: e.i,
    t: e.t,
    x: Math.round((e.x - ox) / GRID),
    y: Math.round((e.y - oy) / GRID),
    w: Math.max(1, Math.round(e.w / GRID)),
    h: Math.max(1, Math.round(e.h / GRID)),
  });

  const chunks = chunk(forModel.map(toUnit), CHUNK_SIZE);
  const results = await Promise.all(
    chunks.map(async (ch) => {
      try {
        const raw = await callDeepSeek(ch);
        const byI = new Map();
        for (const p of raw) {
          if (p && Number.isInteger(p.i)) {
            byI.set(p.i, p);
          }
        }
        // denormalize model units back to absolute pixels
        return ch.map((u) => {
          const p = byI.get(u.i);
          const w = num(p?.w, u.w) > 0 ? num(p?.w, u.w) : u.w;
          const h = num(p?.h, u.h) > 0 ? num(p?.h, u.h) : u.h;
          return {
            i: u.i,
            t: u.t,
            x: ox + num(p?.x, u.x) * GRID,
            y: oy + num(p?.y, u.y) * GRID,
            w: w * GRID,
            h: h * GRID,
          };
        });
      } catch (e) {
        console.error("chunk failed, fallback for chunk:", e.message);
        // originals (absolute); columnAlign will still grid-snap them
        const ids = new Set(ch.map((u) => u.i));
        return forModel.filter((e) => ids.has(e.i));
      }
    }),
  );
  return [...results.flat(), ...passthrough];
};

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }
  if (req.url === "/health") {
    res.writeHead(200);
    return res.end("ok");
  }
  if (req.method !== "POST" || !req.url.startsWith("/api/beautify")) {
    res.writeHead(404);
    return res.end("not found");
  }
  if (rateLimited(clientIp(req))) {
    res.writeHead(429, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "too many requests" }));
  }
  try {
    const body = JSON.parse((await readBody(req)) || "{}");
    const raw = Array.isArray(body.elements) ? body.elements : [];
    if (!raw.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "no elements" }));
    }
    if (raw.length > MAX_ELEMENTS) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "too many elements" }));
    }
    const elements = raw.map(sanitizeElement).filter(Boolean);
    if (!elements.length) {
      res.writeHead(400, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "no valid elements" }));
    }

    let source;
    let laidOut;
    if (modelEnabled) {
      laidOut = await modelLayout(elements);
      source = "deepseek";
    } else {
      laidOut = elements;
      source = KEY ? "fallback" : "fallback-nokey";
    }
    // Final deterministic pass: global column alignment + grid snap. Runs on top
    // of the model output so "borders that should align, align" is guaranteed.
    const patch = columnAlign(laidOut);
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ patch, source, model: MODEL }));
  } catch (e) {
    const status = e?.code === "TOO_LARGE" ? 413 : 500;
    if (status === 500) {
      console.error("beautify handler error:", e);
    }
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        error: status === 413 ? "payload too large" : "beautify failed",
      }),
    );
  }
});

server.listen(PORT, () =>
  console.log(
    `beautify-proxy on :${PORT} (model=${
      modelEnabled ? MODEL : "fallback"
    }, origin=${ALLOWED_ORIGIN})`,
  ),
);
