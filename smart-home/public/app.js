import { HOMES, allDevices, describe, isActive, ICON, ROOM_ICON } from "./homes.js";
import { buildState, buildQuestions, plan, apply } from "./brain.js";

const EXAMPLES = [
  "Turn on the living room lights",
  "Turn off all the lights",
  "Turn on my kid's light",
  "Is the kitchen light on?",
  "Shut off all the music in the house",
  "Get the coffee boiling",
  "Let's get some outside music going",
  "It's going to be a hot day — turn on all the fans",
  "Turn off the kitchen lights and lock the office door",
  "Lock up the whole house",
  "Set the bedroom to heat",
  "Who won the World Series in 1989?",
  "Turn on the living room lights and turn off the kitchen. Oh, and can you get the coffee started?",
];

// Short display labels; the full instructions are sent to the model and shown on hover.
const LABELS = {
  category: "What category of request is this?",
  is_compound: "Is this more than one distinct action?",
  scope: "What domain is this request targeting?",
  available: "Does this home have a matching device?",
  device_type: "What type of device is this request targeting?",
  room: "Which room is the user referring to?",
  device: "Which specific device should receive the command?",
};
const labelFor = (id) => LABELS[id] ?? `What should happen to the ${id.split(".")[1]}s?`;

const VERB = {
  turn_on: "Turned on", turn_off: "Turned off", dim: "Dimmed", brighten: "Brightened",
  lock: "Locked", unlock: "Unlocked", ac_on: "Switched A/C on:", heat_on: "Switched heat on:",
};
const ASK = {
  turn_on: "turn on", turn_off: "turn off", dim: "dim", brighten: "brighten",
  lock: "lock", unlock: "unlock", ac_on: "switch A/C on for", heat_on: "switch heat on for",
};

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const post = async (path, body) => {
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await r.json();
  if (!r.ok) throw new Error(data.detail ? JSON.stringify(data.detail) : data.error || `HTTP ${r.status}`);
  return data;
};

let homeKey = "1br";
let home = structuredClone(HOMES[homeKey]);
let speakingTo = null;
let flashing = new Set();

// ---------- home panel ----------

function renderHome() {
  $("rooms").innerHTML = home.rooms
    .map(
      (r) => `<div class="room"><h3>${ROOM_ICON[r.id] ?? "▫️"} ${esc(r.name)}</h3><div class="devices">${r.devices
        .map(
          (d) => `<div class="device ${isActive(d) ? "active" : ""} ${flashing.has(d.id) ? "flash" : ""} ${speakingTo === d.id ? "ctx" : ""}" title="${d.id}">
            <span class="ico">${ICON[d.type]}</span>
            <div><div class="name">${esc(d.name)}</div><div class="st">${describe(d)}</div></div>
            <span class="dot"></span></div>`,
        )
        .join("")}</div></div>`,
    )
    .join("");
}

function renderContextPicker() {
  $("ctx").innerHTML =
    `<option value="">No Device Context</option>` +
    allDevices(home)
      .filter((d) => d.type === "speaker" || d.type === "thermostat")
      .map((d) => `<option value="${d.id}">Talking to: ${esc(d.name)}</option>`)
      .join("");
  $("ctx").value = speakingTo ?? "";
}

function loadHome(key) {
  homeKey = key;
  home = structuredClone(HOMES[key]);
  speakingTo = null;
  renderContextPicker();
  renderHome();
}

// ---------- decision trace ----------

function confClass(c) {
  return c >= 0.8 ? "hi" : c >= 0.5 ? "mid" : "lo";
}

function traceRows(questions, answers, used) {
  const rows = Object.keys(questions).map((id) => {
    const q = questions[id];
    const a = answers[id];
    let probs, conf;
    if (a.type === "noul") {
      probs = `<span class="top">p(yes) ${a.noul.toFixed(2)}</span>`;
      const c = Math.abs(a.noul - 0.5) * 2; // distance from a coin flip, for coloring only
      conf = `<span class="conf ${confClass(c)}">${a.noul.toFixed(2)}</span>`;
    } else {
      probs = Object.entries(a.probabilities)
        .sort((x, y) => y[1] - x[1])
        .filter(([, p], i) => i < 4 || p >= 0.01)
        .map(([k, p], i) => `<span class="${i === 0 ? "top" : ""}">${esc(k)} ${p.toFixed(2)}</span>`)
        .join(" · ");
      conf = `<span class="conf ${confClass(a.confidence)}">${a.confidence.toFixed(2)}</span>`;
    }
    const instr = typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);
    return `<div class="row ${used.includes(id) ? "used" : ""}" title="${esc(instr)}">
      <span class="tag">${used.includes(id) ? "+ " : ""}${q.type}</span>
      <div><div class="label">${labelFor(id)}</div><div class="probs">${probs}</div></div>${conf}</div>`;
  });
  // Consumed answers first, in decision order, then the speculative ones.
  const order = Object.keys(questions);
  return used
    .map((id) => rows[order.indexOf(id)])
    .concat(order.filter((id) => !used.includes(id)).map((id) => rows[order.indexOf(id)]))
    .join("");
}

function replyHtml(kind, text, extra = "") {
  return `<div class="reply ${kind}">${text}${extra}</div>`;
}

// ---------- the pipeline ----------

async function evaluate(request) {
  const questions = buildQuestions(home);
  const res = await post("/api/systemone", { state: buildState(request, home, speakingTo), questions });
  return { request, questions, res, plan: plan(res.answers, home, speakingTo) };
}

function execute(ev, { force = false } = {}) {
  const p = ev.plan;
  const names = (ts) => ts.map((t) => t.name).join(", ");
  switch (p.kind) {
    case "unavailable":
      return ["bad", "I don't see a device in this home that can do that."];
    case "status":
      if (p.clarify || !p.targets.length) return ["warn", p.clarify ?? "I couldn't find that device."];
      return ["ok", p.targets.map((t) => `${esc(t.name)}: <b>${describe(t)}</b>`).join("<br>")];
    case "command": {
      if (p.clarify) return ["warn", p.clarify];
      if (!p.targets.length) return ["bad", "No matching devices to change."];
      if (p.needsConfirm && !force) return ["confirm", `Not sure. Should I ${ASK[p.action]} ${esc(names(p.targets))}?`];
      for (const t of p.targets) {
        const live = home.rooms.flatMap((r) => r.devices).find((d) => d.id === t.id);
        apply(live, p.action);
        flashing.add(t.id);
      }
      return ["ok", `${VERB[p.action]} ${esc(names(p.targets))}.`];
    }
    default: // a split piece judged compound or general again: don't recurse
      return ["warn", `Skipped: this part looks like a ${p.kind} request.`];
  }
}

async function run(request) {
  const log = $("log");
  $("send").disabled = true;
  $("traceQ").textContent = `"${request}"`;
  $("timing").textContent = "";
  log.innerHTML = `<div class="spin">asking Jev…</div>`;
  flashing = new Set();

  try {
    const ev = await evaluate(request);
    const { res, questions, plan: p } = ev;
    const tokens = res.usage.input_tokens + res.usage.output_tokens;
    $("timing").innerHTML = `TypeSafe <b>${res.latency_ms}ms</b>`;
    const trace = traceRows(questions, res.answers, p.used);
    const foot = `<div class="foot">TypeSafe · ${Object.keys(questions).length} prompts · ${res.latency_ms}ms · ${tokens} tokens · ${res.model}</div>`;

    if (p.kind === "general") {
      log.innerHTML = `<div class="spin">general request → LLM…</div>` + trace + foot;
      const chat = await post("/api/chat", { request });
      $("timing").innerHTML += ` · LLM <b>${chat.latency_ms}ms</b>`;
      log.innerHTML = replyHtml("", `💬 ${esc(chat.reply)}`) + trace + foot;
    } else if (p.kind === "compound") {
      log.innerHTML = `<div class="spin">compound request → splitting…</div>` + trace + foot;
      const split = await post("/api/split", { request });
      // Each atomic command gets its own fan-out; all run in parallel.
      const subs = await Promise.all(split.commands.map(evaluate));
      const slowest = Math.max(...subs.map((s) => s.res.latency_ms));
      $("timing").innerHTML += ` · split (${split.via}) <b>${split.latency_ms}ms</b> · TypeSafe ×${subs.length} <b>${slowest}ms</b>`;
      const parts = subs.map((s) => {
        const [kind, msg] = execute(s, { force: true });
        return `<div class="sub"><p class="q">↳ "${esc(s.request)}"</p>${replyHtml(kind === "confirm" ? "warn" : kind, msg)}${traceRows(s.questions, s.res.answers, s.plan.used)}</div>`;
      });
      log.innerHTML =
        replyHtml("", `Split into ${subs.length} commands.`) +
        parts.join("") +
        `<div class="sub"><p class="q">Original request</p>${trace}</div>` +
        foot;
    } else {
      const [kind, msg] = execute(ev);
      if (kind === "confirm") {
        log.innerHTML =
          replyHtml("warn", msg, `<div><button id="yes">Do it</button><button id="no">Cancel</button></div>`) + trace + foot;
        $("yes").onclick = () => {
          const [k2, m2] = execute(ev, { force: true });
          log.querySelector(".reply").outerHTML = replyHtml(k2, m2);
          renderHome();
        };
        $("no").onclick = () => (log.querySelector(".reply").outerHTML = replyHtml("", "Okay, nothing changed."));
      } else {
        log.innerHTML = replyHtml(kind, msg) + trace + foot;
      }
    }
    renderHome();
  } catch (err) {
    log.innerHTML = replyHtml("bad", `Error: ${esc(err.message)}`);
  } finally {
    $("send").disabled = false;
  }
}

// ---------- wiring ----------

$("chips").innerHTML = EXAMPLES.map((e) => `<button class="chip" type="button">${esc(e)}</button>`).join("");
$("chips").onclick = (e) => {
  if (!e.target.classList.contains("chip")) return;
  $("prompt").value = e.target.textContent;
  run(e.target.textContent);
};
$("form").onsubmit = (e) => {
  e.preventDefault();
  const text = $("prompt").value.trim();
  if (text) run(text);
};
$("homeSel").innerHTML = Object.entries(HOMES).map(([k, h]) => `<option value="${k}">${h.label}</option>`).join("");
$("homeSel").onchange = (e) => loadHome(e.target.value);
$("reset").onclick = () => loadHome(homeKey);
$("ctx").onchange = (e) => {
  speakingTo = e.target.value || null;
  renderHome();
};
loadHome(homeKey);

// Deep links: ?home=family&ctx=kids_room_speaker&q=Turn%20on%20the%20light
const params = new URLSearchParams(location.search);
if (HOMES[params.get("home")]) {
  $("homeSel").value = params.get("home");
  loadHome(params.get("home"));
}
if (params.get("ctx")) {
  speakingTo = params.get("ctx");
  $("ctx").value = speakingTo;
  renderHome();
}
if (params.get("q")) {
  $("prompt").value = params.get("q");
  run(params.get("q"));
}
