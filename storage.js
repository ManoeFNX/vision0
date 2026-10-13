(() => {
  const KEY = 'phonecam_alert_v2';
  const defaults = {
    quality: '1080', fps: '30', facing: 'environment', motion: true,
    sensitivity: 20, cooldown: 5, autoCapture: true,
    notifyMotion: true, notifyPerson: true, notifyBattery: true,
    notifyConnection: true, batteryThreshold: 20, cameraAudio: false,
    recognitionMode: 'high', recognitionThreshold: 60, recognitionNight: true,
    animations: true, glow: true, compact: false, lightTheme: true
  };

  let stored = null;
  try {
    const raw = localStorage.getItem(KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('PhoneCam : stockage local illisible, utilisation des valeurs par défaut.', error);
  }

  const state = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored
    : { settings: { ...defaults }, events: [], devices: {}, stats: { media: 0, sessionStart: Date.now() } };

  state.settings = { ...defaults, ...(state.settings && typeof state.settings === 'object' ? state.settings : {}) };
  state.events = Array.isArray(state.events) ? state.events : [];
  state.devices = state.devices && typeof state.devices === 'object' && !Array.isArray(state.devices) ? state.devices : {};
  state.stats = { media: 0, sessionStart: Date.now(), ...(state.stats && typeof state.stats === 'object' ? state.stats : {}) };

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      console.error('PhoneCam : impossible d’enregistrer les paramètres localement.', error);
      return false;
    }
  }

  function makeId() {
    return window.crypto?.randomUUID?.() || `event-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  window.PCStore = {
    state,
    save,
    defaults,
    addEvent(type, title, detail, unread = true) {
      const event = { id: makeId(), type, title: String(title ?? ''), detail: String(detail ?? ''), time: Date.now(), unread };
      state.events.unshift(event);
      state.events = state.events.slice(0, 300);
      save();
      return event;
    },
    markAllRead() {
      state.events.forEach(event => { event.unread = false; });
      save();
    },
    clearEvents() {
      state.events = [];
      save();
    },
    updateDevice(id, data) {
      state.devices[id] = { ...(state.devices[id] || {}), ...data, lastSeen: Date.now() };
      save();
    },
    removeDevice(id) {
      delete state.devices[id];
      save();
    },
    setSetting(key, value) {
      state.settings[key] = value;
      save();
    },
    clearSettings() {
      state.settings = { ...defaults };
      save();
    }
  };
})();
