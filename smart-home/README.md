# Jev smart-home demo (recreation)

A from-scratch recreation of TypeSafe's [smart home assistant demo](https://docs.typesafe.ai/demos/smart-home),
built from the docs page, the demo video and the public API docs. Plain HTML + ES modules, no build step.

```sh
export TYPESAFE_API_KEY=...        # or TYPESAFE_TOKEN
export ANTHROPIC_API_KEY=...       # optional: LLM splitting + conversational fallback
npm start                          # http://localhost:5173
```

Deep links run a request on load: `/?home=family&ctx=kids_room_speaker&q=make%20it%20cozy%20in%20here`

## How it works

| File | Role |
| --- | --- |
| `public/brain.js` | Builds state + the 13 questions, turns answers into a plan (`plan`), applies actions. No DOM, so it runs under Node. |
| `public/homes.js` | House configs. Device/room ids are Choice option keys, so answers are ids code can act on directly. |
| `public/app.js` | UI: device grid, decision trace, confirm flow, compound/general orchestration. |
| `server.js` | Static files + `/api/systemone`, `/api/split`, `/api/chat` proxies so keys stay server-side. |

**Speculative fan-out.** Every request sends all 13 questions in one call: category, is_compound, available,
scope, device_type, room, device, and a "what should happen to the X?" question for each of the six device
types, asked before the code knows which type applies. `plan()` reads only the answers its branch needs and
records them in `used`; the trace highlights those and dims the rest.

**Confidence gating.** A plan's confidence is the *minimum* over the Choice answers it consumed (as in the
function-calling cookbook). Below 0.5 the UI asks before acting; unlocking a door needs 0.85.

**LLM pairing.** `is_compound > 0.5` sends the request to an LLM to split into atomic commands, and each piece
gets its own fan-out in parallel. `category == general` goes to an LLM for a freeform reply. Without
`ANTHROPIC_API_KEY`, splitting uses a regex heuristic and general questions get a canned reply.

## Differences from the original

- The original is Vite/React and its source isn't published yet. This is a behavioral recreation.
- Adds an `available` Noul, so "outside music" in a home with no patio says so instead of playing the living-room speaker.
- `scope` is whole_house vs specific. A three-way room/device split scored ~0.4 confidence on harmless ambiguity
  ("the kitchen light" is both), so the device Choice decides between one device and a room instead.
