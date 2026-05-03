'use strict';





const _logBuffer = [];   // { level, ts, text }[]
const MAX_LOGS   = 500;

function _appendLog(level, args) {
  const ts   = new Date().toLocaleTimeString('ru', { hour12: false });
  const text = args.map(a => {
    if (typeof a === 'string') return a;
    try { return JSON.stringify(a); } catch { return String(a); }
  }).join(' ');

  _logBuffer.push({ level, ts, text });
  if (_logBuffer.length > MAX_LOGS) _logBuffer.shift();

  _renderLogLine({ level, ts, text });
}

function _renderLogLine(entry) {
  const el = document.getElementById('app-log-output');
  if (!el) return;

  const div = document.createElement('div');
  div.className = 'log-' + entry.level;
  div.textContent = `[${entry.ts}] ${entry.text}`;
  el.appendChild(div);

  if (el.scrollHeight - el.scrollTop < el.clientHeight + 60) {
    el.scrollTop = el.scrollHeight;
  }
}


(function() {
  const orig = { log: console.log, warn: console.warn, error: console.error };

  console.log = (...a) => { orig.log(...a);   _appendLog('info',  a); };
  console.warn  = (...a) => { orig.warn(...a);  _appendLog('warn',  a); };
  console.error = (...a) => { orig.error(...a); _appendLog('error', a); };


  window.addEventListener('error', e => {
    _appendLog('error', [`[unhandled] ${e.message} @ ${e.filename}:${e.lineno}`]);
  });
  window.addEventListener('unhandledrejection', e => {
    _appendLog('error', [`[promise] ${e.reason?.message || e.reason}`]);
  });
})();


function switchSettingsTab(name) {
  document.getElementById('tab-settings').style.display = name === 'settings' ? '' : 'none';
  document.getElementById('tab-data').style.display     = name === 'data'     ? '' : 'none';
  document.getElementById('tab-logs').style.display     = name === 'logs'     ? '' : 'none';
  document.getElementById('tab-btn-settings').classList.toggle('active', name === 'settings');
  document.getElementById('tab-btn-data').classList.toggle('active',     name === 'data');
  document.getElementById('tab-btn-logs').classList.toggle('active',     name === 'logs');

  if (name === 'logs') {
    const el = document.getElementById('app-log-output');
    if (el && el.children.length === 0) {
      _logBuffer.forEach(_renderLogLine);
      el.scrollTop = el.scrollHeight;
    }
  }
}


function clearAppLogs() {
  _logBuffer.length = 0;
  const el = document.getElementById('app-log-output');
  if (el) el.innerHTML = '';
}

function copyAppLogs() {
  const text = _logBuffer.map(e => `[${e.ts}] [${e.level}] ${e.text}`).join('\n');
  navigator.clipboard?.writeText(text).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
}


async function showSwLog() {
  try {
    const cache = await caches.open('screw-sw-state');
    const resp  = await cache.match('/sw-log');
    const text  = resp ? await resp.text() : '(empty)';
    _appendLog('info', ['[SW LOG]\n' + text]);
    const el = document.getElementById('app-log-output');
    if (el) el.scrollTop = el.scrollHeight;
  } catch (e) {
    _appendLog('error', ['[SW LOG] error: ' + e.message]);
  }
}

