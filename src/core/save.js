const SAVE_KEY = 'couronnes-corail.save.v1';
const SETTINGS_KEY = 'couronnes-corail.settings.v1';

export function saveLocal(state) {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* storage is optional */ }
}

export function saveSettings(settings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage is optional */ }
}

export function loadSettings() {
  try {
    return { language: 'en', sound: true, zoom: 1, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { language: 'en', sound: true, zoom: 1 };
  }
}
