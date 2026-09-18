// The TypeSafe half of the demo: one request carries every question the
// dispatcher might need (speculative fan-out); code then reads only the
// answers that apply. No DOM here, so it also runs under Node for testing.

import { allDevices, describe } from "./homes.js";

export const NONE = "none_of_these";

// Speculative per-type action questions. Keys are the action names the
// executor understands, so no mapping is needed afterwards.
const ACTIONS = {
  light: {
    label: "lights",
    criteria: {
      turn_on: "Switch the lights on",
      turn_off: "Switch the lights off",
      dim: "Make the lights dimmer or softer, but keep them on",
      brighten: "Make the lights brighter or full brightness",
    },
  },
  fan: { label: "fans", criteria: { turn_on: "Start the fans", turn_off: "Stop the fans" } },
  speaker: {
    label: "speakers",
    criteria: { turn_on: "Start playing music or audio", turn_off: "Stop, pause, or silence the music or audio" },
  },
  thermostat: {
    label: "thermostats",
    criteria: {
      turn_off: "Turn heating and cooling off",
      ac_on: "Cool the space: air conditioning on",
      heat_on: "Warm the space: heating on",
    },
  },
  appliance: {
    label: "appliances",
    criteria: { turn_on: "Start the appliance (brew, boil, run)", turn_off: "Stop or switch off the appliance" },
  },
  lock: { label: "locks", criteria: { lock: "Lock or secure the door", unlock: "Unlock or open the door" } },
};

// Actions that deserve more certainty before running unattended.
const RISKY = new Set(["lock.unlock"]);

export function buildState(request, home, speakingTo) {
  const devices = allDevices(home);
  const ctx = speakingTo && devices.find((d) => d.id === speakingTo);
  return {
    request,
    speaking_to: ctx
      ? { device: ctx.name, room: home.rooms.find((r) => r.id === ctx.room).name }
      : "unknown (the user is not talking to a device in a particular room)",
    home: home.rooms.map((r) => ({
      room: r.name,
      devices: r.devices.map((d) => ({ name: d.name, type: d.type, status: describe(d) })),
    })),
  };
}

export function buildQuestions(home) {
  const rooms = Object.fromEntries(home.rooms.map((r) => [r.id, r.name]));
  const devices = Object.fromEntries(
    allDevices(home).map((d) => [d.id, `${d.name}: the ${d.type} in the ${rooms[d.room]}`]),
  );
  const q = {
    category: {
      type: "choice",
      instructions: "What category of request is `request`, given the smart home described in `home`?",
      criteria: {
        command: "Asks to change something in the home: switch, dim, play, stop, lock, heat, cool, or start a device",
        status_question: "Asks about the current state of a device or room, without asking to change anything",
        general: "General knowledge, conversation, or anything that is not about the devices in this home",
      },
    },
    is_compound: {
      type: "noul",
      instructions:
        "Does `request` ask for two or more distinct actions, such as different actions, device types, or rooms? " +
        "One action applied to a group (\"turn off all the lights\") counts as a single action.",
    },
    scope: {
      type: "choice",
      instructions: "What domain of the home is `request` targeting?",
      criteria: {
        whole_house: "Every matching device anywhere in the house: \"all the lights\", \"the whole house\", \"everywhere\"",
        specific: "A particular room or a particular device",
      },
    },
    available: {
      type: "noul",
      instructions:
        "Is at least one device listed in `home` a match for what `request` asks for? Only the devices listed in `home` exist.",
      criteria: {
        true: "A listed device matches the kind of device and the location the request asks for",
        false:
          "The request needs a device or location that is not listed in `home`, " +
          "such as outdoor speakers in a home with no outdoor room",
      },
    },
    device_type: {
      type: "choice",
      instructions: "What type of device is `request` about?",
      criteria: {
        light: "Lights and lamps",
        fan: "Fans",
        speaker: "Speakers, music, podcasts, audio",
        thermostat: "Heating, cooling, air conditioning, temperature",
        appliance: "Kitchen appliances such as a coffee maker or kettle",
        lock: "Door locks, locking up, security",
      },
    },
    room: {
      type: "choice",
      instructions:
        "Which room of `home` is `request` referring to? If the request names no room or says \"here\", " +
        "use the room in `speaking_to` when one is given. Answer none_of_these when no room of this home fits.",
      criteria: { ...rooms, [NONE]: "No room in this home fits, or the request is not about one room" },
    },
    device: {
      type: "choice",
      instructions:
        "Which specific device in `home` should receive `request`? Answer none_of_these if the request is about " +
        "a group of devices, or if no device in this home matches what the user describes.",
      criteria: { ...devices, [NONE]: "A group of devices, or no device in this home matches" },
    },
  };
  for (const [type, { label, criteria }] of Object.entries(ACTIONS)) {
    q[`action.${type}`] = {
      type: "choice",
      instructions: `Assume \`request\` is about ${label}. What should happen to the ${label}?`,
      criteria,
    };
  }
  return q;
}

// Turn answers into a plan. `used` records which answers the decision
// actually consumed; everything else was speculative and is ignored.
export function plan(answers, home, speakingTo) {
  const devices = allDevices(home);
  const used = ["category"];
  const conf = (ids) => Math.min(...ids.map((id) => answers[id].confidence ?? 1));
  const category = answers.category.choice;

  if (category === "general") return { kind: "general", used, confidence: conf(used) };

  if (category === "command" && answers.is_compound.noul > 0.5) {
    return { kind: "compound", used: [...used, "is_compound"], confidence: conf(used) };
  }
  used.push("is_compound", "available", "scope", "device_type");
  if (answers.available.noul < 0.5) {
    return { kind: "unavailable", used, confidence: conf(used), targets: [] };
  }

  let type = answers.device_type.choice;
  const deviceId = answers.device.choice;
  const roomId = answers.room.choice;
  const contextRoom = devices.find((d) => d.id === speakingTo)?.room;
  let targets = [];
  let clarify = null;

  if (answers.scope.choice === "whole_house") {
    targets = devices.filter((d) => d.type === type);
  } else {
    used.push("device");
    if (deviceId !== NONE) {
      const d = devices.find((x) => x.id === deviceId);
      type = d.type; // the named device wins over the type guess
      targets = [d];
    } else {
      used.push("room");
      const room = roomId !== NONE ? roomId : contextRoom;
      if (room) targets = devices.filter((d) => d.room === room && d.type === type);
      else {
        const ofType = devices.filter((d) => d.type === type);
        if (ofType.length === 1) targets = ofType;
        else clarify = `Which ${ACTIONS[type].label}? I couldn't tell which room you meant.`;
      }
    }
  }

  const base = { targets, type, clarify };
  if (category === "status_question") {
    return { kind: "status", used, confidence: conf(used), ...base };
  }

  const actionQ = `action.${type}`;
  used.push(actionQ);
  const action = answers[actionQ].choice;
  const confidence = conf(used);
  // Confidence-gated execution: thresholds scale with the stakes.
  const threshold = RISKY.has(`${type}.${action}`) ? 0.85 : 0.5;
  return { kind: "command", used, confidence, action, needsConfirm: confidence < threshold, ...base };
}

export function apply(device, action) {
  const d = device;
  switch (d.type) {
    case "light":
      if (action === "turn_on") Object.assign(d, { on: true, brightness: d.brightness || 100 });
      if (action === "turn_off") d.on = false;
      if (action === "dim") Object.assign(d, { on: true, brightness: Math.max(10, Math.min(30, d.brightness - 30)) });
      if (action === "brighten") Object.assign(d, { on: true, brightness: 100 });
      break;
    case "lock":
      d.locked = action === "lock";
      break;
    case "thermostat":
      d.mode = { turn_off: "off", ac_on: "ac", heat_on: "heat" }[action];
      break;
    default:
      d.on = action === "turn_on";
  }
}

export const ACTION_LABEL = (type, action) => ACTIONS[type]?.criteria[action] ?? action;
