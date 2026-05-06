// LibreFlow — IPC helpers (Tauri v2 withGlobalTauri)
// OPT-1.1: Event-based instead of polling

let _tauriReady = null;

function _waitTauriReady() {
  if (_tauriReady) return _tauriReady;
  return (_tauriReady = new Promise(res => {
    if (window.__TAURI__) { res(); return; }
    const handler = () => {
      window.removeEventListener('tauri://init', handler);
      res();
    };
    window.addEventListener('tauri://init', handler);
    setTimeout(res, 5000);
  }));
}

async function invoke(cmd, args) {
  await _waitTauriReady();
  return window.__TAURI__.core.invoke(cmd, args);
}

async function listen(event, handler, options) {
  await _waitTauriReady();
  return options
    ? window.__TAURI__.event.listen(event, handler, options)
    : window.__TAURI__.event.listen(event, handler);
}

function convertFileSrc(filePath) {
  // Normalise les backslashes Windows en slashes avant toute conversion.
  // Tauri convertFileSrc encode \ en %5C au lieu de / → 404 sur asset.localhost.
  const normalized = filePath.replace(/\\/g, '/');
  if (window.__TAURI__?.core?.convertFileSrc) {
    return window.__TAURI__.core.convertFileSrc(normalized);
  }
  const encoded = encodeURIComponent(normalized)
    .replace(/%3A/gi, ':')
    .replace(/%2F/g, '/');
  return `asset://localhost/${encoded}`;
}

async function invokeRetry(cmd, args, maxRetries = 3) {
  let delay = 200;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await invoke(cmd, args);
    } catch (err) {
      if (attempt === maxRetries - 1) throw err;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

export { invoke, invokeRetry, listen, convertFileSrc };
