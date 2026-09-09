const SETTINGS_KEY = 'backrooms_settings_v1';

export const SETTINGS_DEFAULTS = {
  master: 0.55,
  sfx: 1,
  sensitivity: 0.0022,
  fov: 79,
  invertY: false,
  reduceMotion: false,
};

export class Settings {
  constructor() {
    this.data = { ...SETTINGS_DEFAULTS };
    this._listeners = [];
    this.load();
  }

  load() {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return;
      this.data = { ...SETTINGS_DEFAULTS, ...parsed };
      this.data.master = clamp(this.data.master, 0, 1);
      this.data.sfx = clamp(this.data.sfx, 0, 1);
      this.data.sensitivity = clamp(this.data.sensitivity, 0.0008, 0.006);
      this.data.fov = clamp(this.data.fov, 60, 95);
      this.data.invertY = !!this.data.invertY;
      this.data.reduceMotion = !!this.data.reduceMotion;
    } catch (e) {
      console.warn('Settings load failed', e);
    }
  }

  save() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.data));
    } catch (e) {
      console.warn('Settings save failed', e);
    }
    this._emit();
  }

  set(key, value) {
    if (!(key in SETTINGS_DEFAULTS)) return;
    this.data[key] = value;
    this.save();
  }

  onChange(fn) {
    this._listeners.push(fn);
    return () => {
      const i = this._listeners.indexOf(fn);
      if (i >= 0) this._listeners.splice(i, 1);
    };
  }

  _emit() {
    for (const fn of this._listeners.slice()) fn(this.data);
  }
}

function clamp(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}
