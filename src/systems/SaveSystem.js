const SAVE_KEY = 'backrooms_save_v1';
const SAVE_VERSION = 3;

export class SaveSystem {
  hasSave() {
    try { return !!localStorage.getItem(SAVE_KEY); } catch { return false; }
  }

  save(state) {
    try {
      const payload = { ...state, version: state.version || SAVE_VERSION };
      localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
      return true;
    } catch (e) {
      console.warn('Save failed', e);
      return false;
    }
  }

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      return this._migrate(JSON.parse(raw));
    } catch (e) {
      console.warn('Load failed', e);
      return null;
    }
  }

  _migrate(data) {
    if (!data || typeof data !== 'object') return null;
    const version = data.version || 1;
    if (version < 2) {
      if (data.stamina == null) data.stamina = 100;
      if (data.pitch == null) data.pitch = 0;
      if (data.crouching == null) data.crouching = false;
    }
    if (version < 3) {
      delete data.story;
      delete data.director;
      delete data.foundNoteIds;
    }
    data.version = SAVE_VERSION;
    return data;
  }

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch {}
  }
}
