// A short history of notable things, kept small so the save stays light.

const MAX_EVENTS = 80;

export class EventLog {
  constructor() { this.items = []; this.listeners = []; }
  add(minute, text, kind = 'info') {
    const e = { minute, text, kind };
    this.items.push(e);
    if (this.items.length > MAX_EVENTS) this.items.shift();
    for (const fn of this.listeners) fn(e);
  }
  since(minute) { return this.items.filter(e => e.minute >= minute); }
  onAdd(fn) { this.listeners.push(fn); }
  toJSON() { return this.items; }
  load(items) { this.items = items || []; }
}
