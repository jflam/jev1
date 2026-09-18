// House configurations. Device ids double as Choice option keys, so the
// model's answer is directly an id the code can act on.

const light = (id, name, on = false, brightness = 100) => ({ id, name, type: "light", on, brightness });
const fan = (id, name, on = false) => ({ id, name, type: "fan", on });
const speaker = (id, name, on = false) => ({ id, name, type: "speaker", on });
const appliance = (id, name, on = false) => ({ id, name, type: "appliance", on });
const lock = (id, name, locked = true) => ({ id, name, type: "lock", locked });
const thermostat = (id, name, mode = "off", target = 72) => ({ id, name, type: "thermostat", mode, target });

export const HOMES = {
  "1br": {
    label: "1BR (10 devices)",
    rooms: [
      {
        id: "living_room",
        name: "Living Room",
        devices: [
          light("living_room_overhead", "Overhead Lights", true, 80),
          light("living_room_lamp", "Floor Lamp", true, 50),
          fan("living_room_fan", "Ceiling Fan"),
          speaker("living_room_speaker", "Smart Speaker"),
        ],
      },
      {
        id: "kitchen",
        name: "Kitchen",
        devices: [light("kitchen_light", "Kitchen Lights"), appliance("kitchen_coffee_maker", "Coffee Maker")],
      },
      {
        id: "bedroom",
        name: "Bedroom",
        devices: [light("bedroom_light", "Bedroom Light"), thermostat("bedroom_thermostat", "Thermostat", "ac", 72)],
      },
      {
        id: "office",
        name: "Office",
        devices: [light("office_light", "Desk Lamp"), lock("office_lock", "Door Lock", true)],
      },
    ],
  },
  family: {
    label: "Family home (19 devices)",
    rooms: [
      {
        id: "living_room",
        name: "Living Room",
        devices: [
          light("living_room_overhead", "Overhead Lights", true, 80),
          light("living_room_lamp", "Floor Lamp"),
          fan("living_room_fan", "Ceiling Fan"),
          speaker("living_room_speaker", "Sonos Speaker"),
          thermostat("hallway_thermostat", "Main Thermostat", "off", 70),
        ],
      },
      {
        id: "kitchen",
        name: "Kitchen",
        devices: [
          light("kitchen_light", "Kitchen Lights", true),
          appliance("kitchen_coffee_maker", "Coffee Maker"),
          appliance("kitchen_kettle", "Electric Kettle"),
        ],
      },
      {
        id: "primary_bedroom",
        name: "Primary Bedroom",
        devices: [light("primary_bedroom_light", "Bedside Lamps"), fan("primary_bedroom_fan", "Ceiling Fan")],
      },
      {
        id: "kids_room",
        name: "Maya's Room (kid)",
        devices: [
          light("kids_room_light", "Night Light"),
          fan("kids_room_fan", "Tower Fan"),
          speaker("kids_room_speaker", "Story Speaker"),
        ],
      },
      {
        id: "office",
        name: "Office",
        devices: [light("office_light", "Desk Lamp", true, 60), lock("office_lock", "Door Lock", false)],
      },
      {
        id: "patio",
        name: "Patio",
        devices: [light("patio_lights", "String Lights"), speaker("patio_speakers", "Outdoor Speakers")],
      },
      {
        id: "entry",
        name: "Entry & Garage",
        devices: [lock("front_door_lock", "Front Door", false), lock("garage_door_lock", "Garage Door", true)],
      },
    ],
  },
};

export const allDevices = (home) => home.rooms.flatMap((r) => r.devices.map((d) => ({ ...d, room: r.id })));

export function describe(d) {
  switch (d.type) {
    case "light": return d.on ? `On · ${d.brightness}%` : "Off";
    case "fan": return d.on ? "On" : "Off";
    case "speaker": return d.on ? "Playing" : "Off";
    case "appliance": return d.on ? "On" : "Off";
    case "lock": return d.locked ? "Locked" : "Unlocked";
    case "thermostat":
      return d.mode === "off" ? "Off" : `${d.mode === "ac" ? "A/C" : "Heat"} · ${d.target}°F`;
  }
}

export const isActive = (d) => (d.type === "lock" ? d.locked : d.type === "thermostat" ? d.mode !== "off" : d.on);

export const ICON = { light: "💡", fan: "🌀", speaker: "🔊", appliance: "☕", lock: "🔒", thermostat: "🌡️" };
export const ROOM_ICON = {
  living_room: "🛋️", kitchen: "🍳", bedroom: "🛏️", primary_bedroom: "🛏️", kids_room: "🧸",
  office: "🖥️", patio: "🌿", entry: "🚪",
};
