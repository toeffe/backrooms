const MAX_SLOTS = 10;

export const ITEM_DEFS = {
  battery: { name: 'AA Battery', desc: 'Half-drained. Better than nothing.' },
  canned_food: { name: 'Canned Food', desc: 'No label. Someone left it behind.' },
  bandage: { name: 'Bandage', desc: 'Used once already. Still usable.' },
  strange_coin: { name: 'Strange Coin', desc: "Doesn't match any currency you recognize." },
  map_fragment: { name: 'Map Fragment', desc: 'A hand-drawn corridor sketch. Might not be accurate anymore.' },
};

export class Inventory {
  constructor(eventBus) {
    this.bus = eventBus;
    this.slots = [];
  }

  add(defKey, extra = {}) {
    if (this.slots.length >= MAX_SLOTS) {
      this.bus.emit('message', 'Your hands are full.');
      return false;
    }
    this.slots.push({ id: cryptoId(), defKey, ...extra });
    const def = ITEM_DEFS[defKey];
    this.bus.emit('message', `Picked up: ${def ? def.name : defKey}`);
    this.bus.emit('inventory-changed', this.slots);
    return true;
  }

  remove(id) {
    this.slots = this.slots.filter(s => s.id !== id);
    this.bus.emit('inventory-changed', this.slots);
  }

  has(defKey) {
    return this.slots.some(s => s.defKey === defKey);
  }

  consume(defKey) {
    const item = this.slots.find((s) => s.defKey === defKey);
    if (!item) return false;
    this.remove(item.id);
    return true;
  }

  serialize() {
    return this.slots;
  }

  load(data) {
    this.slots = (data || []).filter((s) => s && ITEM_DEFS[s.defKey]);
    this.bus.emit('inventory-changed', this.slots);
  }
}

function cryptoId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
