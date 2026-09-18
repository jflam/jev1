// Zero-dependency server: serves the static HTML app and proxies the two
// model calls so API keys never reach the browser.
//
//   TYPESAFE_API_KEY (or TYPESAFE_TOKEN)  required
//   ANTHROPIC_API_KEY                      optional: enables compound-request
//                                          splitting and conversational fallback
//   PORT                                   default 5173

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "public");
const PORT = Number(process.env.PORT || 5173);
const TYPESAFE_KEY = process.env.TYPESAFE_API_KEY || process.env.TYPESAFE_TOKEN;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const LLM_MODEL = process.env.LLM_MODEL || "claude-haiku-4-5";

if (!TYPESAFE_KEY) {
  console.error("Set TYPESAFE_API_KEY (or TYPESAFE_TOKEN) before starting.");
  process.exit(1);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" };

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return JSON.parse(body || "{}");
}

function send(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// POST /api/systemone  { state, questions }  ->  TypeSafe response + latency
async function systemOne(req, res) {
  const { state, questions } = await readJson(req);
  const started = performance.now();
  for (let attempt = 0; ; attempt++) {
    const r = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { Authorization: `Bearer ${TYPESAFE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ state, questions, model: "jev-latest" }),
    });
    // 429 / 529 are retryable per the API docs; back off exponentially.
    if ((r.status === 429 || r.status === 529) && attempt < 3) {
      await new Promise((ok) => setTimeout(ok, 250 * 2 ** attempt));
      continue;
    }
    const data = await r.json();
    return send(res, r.status, { ...data, latency_ms: Math.round(performance.now() - started) });
  }
}

async function claude(system, user, maxTokens) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  const data = await r.json();
  if (!r.ok) throw new Error(data?.error?.message || `LLM error ${r.status}`);
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

// POST /api/split  { request }  ->  { commands: string[], via }
async function split(req, res) {
  const { request } = await readJson(req);
  const started = performance.now();
  if (!ANTHROPIC_KEY) {
    // Naive fallback so the demo still works without an LLM key.
    const commands = request
      .split(/\s*(?:[.;!?]+\s*|,?\s+and\s+(?:then\s+)?|,\s*then\s+|\boh,?\s*)/i)
      .map((s) => s.replace(/^(and|also|oh|then)\b[,\s]*/i, "").trim())
      .filter((s) => s.split(/\s+/).length >= 2);
    return send(res, 200, { commands, via: "heuristic", latency_ms: Math.round(performance.now() - started) });
  }
  const text = await claude(
    "You split a smart-home request into atomic commands. Each command must do exactly one action and be " +
      "understandable on its own (repeat the room or device when the original shares it across clauses). " +
      'Reply with only a JSON array of strings, e.g. ["Turn off the kitchen lights", "Lock the office door"].',
    request,
    300,
  );
  const commands = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
  send(res, 200, { commands, via: LLM_MODEL, latency_ms: Math.round(performance.now() - started) });
}

// POST /api/chat  { request }  ->  { reply, via }
async function chat(req, res) {
  const { request } = await readJson(req);
  const started = performance.now();
  if (!ANTHROPIC_KEY) {
    return send(res, 200, {
      reply: "That sounds like a general question. Set ANTHROPIC_API_KEY to let an LLM answer it.",
      via: "none",
      latency_ms: 0,
    });
  }
  const reply = await claude(
    "You are a friendly smart-home assistant answering a general question. Reply in one or two short sentences.",
    request,
    200,
  );
  send(res, 200, { reply, via: LLM_MODEL, latency_ms: Math.round(performance.now() - started) });
}

const routes = { "/api/systemone": systemOne, "/api/split": split, "/api/chat": chat };

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "POST" && routes[url.pathname]) return await routes[url.pathname](req, res);
    if (req.method === "GET" && url.pathname === "/api/config") return send(res, 200, { llm: ANTHROPIC_KEY ? LLM_MODEL : null });
    const path = normalize(url.pathname === "/" ? "/index.html" : url.pathname);
    if (path.includes("..")) return send(res, 400, { error: "bad path" });
    const file = await readFile(join(ROOT, path));
    res.writeHead(200, { "Content-Type": MIME[extname(path)] || "application/octet-stream" });
    res.end(file);
  } catch (err) {
    if (err.code === "ENOENT") return send(res, 404, { error: "not found" });
    console.error(err);
    send(res, 500, { error: err.message });
  }
}).listen(PORT, () => {
  console.log(`Smart home demo on http://localhost:${PORT}  (LLM: ${ANTHROPIC_KEY ? LLM_MODEL : "not configured"})`);
});
