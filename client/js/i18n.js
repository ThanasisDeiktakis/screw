'use strict';

/**
 * Lightweight i18n.
 * English text lives in code as fallbacks: t('key', 'English text').
 * Translations loaded from /locales/{lang}.js which sets window._locale = {...}.
 */

window._locale = null;
window._lang = localStorage.getItem('screw_lang') || _detectLang();

function _detectLang() {
  const nav = (navigator.language || '').toLowerCase();
  if (nav.startsWith('el')) return 'el';
  if (nav.startsWith('ru')) return 'ru';
  return 'en';
}

function t(key, fallback) {
  if (window._locale && window._locale[key] !== undefined) return window._locale[key];
  return fallback !== undefined ? fallback : key;
}

function setLang(lang, noReload) {
  window._lang = lang;
  localStorage.setItem('screw_lang', lang);
  if (noReload) {
    // Reload locale in-place and re-apply DOM translations
    window._locale = null;
    _loadLocale().then(() => _applyDomTranslations());
    return;
  }
  location.reload();
}

function _loadLocale() {
  if (window._lang === 'en') return Promise.resolve();
  return new Promise(resolve => {
    const s = document.createElement('script');
    s.src = `/locales/${window._lang}.js`;
    s.onload = resolve;
    s.onerror = () => { console.warn('[i18n] locale not found:', window._lang); resolve(); };
    document.head.appendChild(s);
  });
}

/** Apply translations to elements with data-i18n attribute */
function _applyDomTranslations() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    // Save original English text on first encounter
    if (!el.hasAttribute('data-i18n-orig')) {
      if (el.children.length) {
        const tn = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
        if (tn) el.setAttribute('data-i18n-orig', tn.textContent.trim());
      } else {
        el.setAttribute('data-i18n-orig', el.textContent);
      }
    }
    const orig = el.getAttribute('data-i18n-orig') || key;
    const val = t(key, orig);
    if (el.children.length) {
      const tn = Array.from(el.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());
      if (tn) tn.textContent = val + '\n';
      else el.insertBefore(document.createTextNode(val + '\n'), el.firstChild);
    } else {
      el.textContent = val;
    }
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (!el.hasAttribute('data-i18n-ph-orig')) {
      el.setAttribute('data-i18n-ph-orig', el.placeholder);
    }
    el.placeholder = t(key, el.getAttribute('data-i18n-ph-orig') || '');
  });
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title');
    if (!el.hasAttribute('data-i18n-ti-orig')) {
      el.setAttribute('data-i18n-ti-orig', el.title);
    }
    el.title = t(key, el.getAttribute('data-i18n-ti-orig') || '');
  });
}

