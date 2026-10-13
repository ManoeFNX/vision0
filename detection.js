(() => {
  let timer = null;
  let local = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  let last = null;
  let lastAlert = 0;
  let connection = null;
  let armed = true;
  let lastMotionAt = 0;
  let quietTimer = null;
  const CALM_MS = 850;
  const $ = selector => document.querySelector(selector);

  function setStatus(text) {
    const labels = local ? ['#phoneDetection'] : ['#cameraMotionState', '#motionOverlay'];
    labels.forEach(selector => {
      const element = $(selector);
      if (element) element.textContent = text;
    });
  }

  function analyze(video, send) {
    if (!video || video.readyState < 2 || !video.videoWidth) return;

    const settings = window.PCStore?.state?.settings || {};
    if (!settings.motion) {
      last = null;
      armed = true;
      lastMotionAt = 0;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = null;
      setStatus('Analyse inactive');
      return;
    }

    canvas.width = 128;
    canvas.height = Math.max(72, Math.round(128 * video.videoHeight / video.videoWidth));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const image = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    if (!last) {
      last = image;
      setStatus('🟢 Analyse active');
      return;
    }

    let diff = 0;
    for (let i = 0; i < image.length; i += 16) {
      diff += Math.abs(image[i] - last[i]) + Math.abs(image[i + 1] - last[i + 1]) + Math.abs(image[i + 2] - last[i + 2]);
    }
    const score = diff / (image.length / 16 * 3 * 255);
    last = image;

    const sensitivity = Number(settings.sensitivity ?? 20);
    const threshold = Math.max(0.024, 0.058 - (sensitivity - 5) * 0.0010);
    const moved = score > threshold;
    setStatus(moved ? '🔴 Mouvement détecté' : '🟢 Analyse active');

    const now = Date.now();
    const cooldownMs = Math.max(0, Number(settings.cooldown ?? 5)) * 1000;
    if (moved) {
      lastMotionAt = now;
      if (quietTimer) clearTimeout(quietTimer);
      quietTimer = setTimeout(() => { armed = true; }, CALM_MS);

      // One alert per distinct passage, respecting the configurable cooldown.
      if (armed && now - lastAlert >= cooldownMs) {
        armed = false;
        lastAlert = now;
        if (send && connection?.open) {
          try {
            connection.send({ type: 'motion', score: Number(score.toFixed(4)), time: now, capture: true });
          } catch (error) {
            console.debug('Envoi de l’alerte de mouvement impossible.', error);
          }
        }
        // Automatic capture is controlled by the actual setting, not just by the UI.
        if (local && settings.autoCapture !== false && window.PCCamera?.getLocal?.() && window.PCApp?.phoneAutoCapture) {
          window.PCApp.phoneAutoCapture('passage');
        }
      }
    } else if (lastMotionAt && now - lastMotionAt >= CALM_MS) {
      armed = true;
    }
  }

  function startLocal(stream) {
    stop();
    local = true;
    connection = window.PCPhone?.connection || null;
    timer = setInterval(() => analyze($('#localVideo'), true), 100);
  }

  function startPC(stream) {
    stop();
    local = false;
    timer = setInterval(() => analyze($('#remoteVideo'), false), 160);
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (quietTimer) clearTimeout(quietTimer);
    timer = null;
    quietTimer = null;
    last = null;
    local = false;
    connection = null;
    armed = true;
    lastMotionAt = 0;
    lastAlert = 0;
  }

  window.PCDetection = { startLocal, startPC, stop, analyze };
})();
