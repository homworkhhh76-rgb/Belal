import { useEffect, useState } from 'react';

let deferredInstallPrompt = null;
let appInstalled = typeof window !== 'undefined' && (
  window.matchMedia?.('(display-mode: standalone)')?.matches === true ||
  window.navigator?.standalone === true
);
const subscribers = new Set();
let listenersBound = false;

function isIOSDevice() {
  if (typeof window === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(window.navigator?.userAgent || '');
}

function isSecureInstallContext() {
  if (typeof window === 'undefined') return false;
  return !!window.isSecureContext || ['localhost', '127.0.0.1'].includes(window.location?.hostname || '');
}

function snapshot() {
  return {
    isInstallable: !appInstalled && !!deferredInstallPrompt,
    isInstalled: !!appInstalled,
    isIOS: isIOSDevice(),
    isSecureContext: isSecureInstallContext(),
  };
}

function emit() {
  const state = snapshot();
  subscribers.forEach((fn) => {
    try { fn(state); } catch (_) {}
  });
  try { window.dispatchEvent(new CustomEvent('oscar:pwa-status', { detail: state })); } catch (_) {}
}

function bindGlobalInstallListeners() {
  if (listenersBound || typeof window === 'undefined') return;
  listenersBound = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    appInstalled = false;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    appInstalled = true;
    emit();
  });

  try {
    window.matchMedia?.('(display-mode: standalone)')?.addEventListener?.('change', (event) => {
      if (event.matches) {
        appInstalled = true;
        deferredInstallPrompt = null;
        emit();
      }
    });
  } catch (_) {}
}

bindGlobalInstallListeners();

export function getPWAInstallStatus() {
  return snapshot();
}

export async function promptPWAInstall() {
  bindGlobalInstallListeners();
  if (appInstalled) return { installed: true, alreadyInstalled: true, outcome: 'installed' };
  if (!deferredInstallPrompt) return { installed: false, unavailable: true, outcome: 'unavailable' };

  const event = deferredInstallPrompt;
  deferredInstallPrompt = null;
  emit();

  try {
    await event.prompt();
    const choice = await event.userChoice;
    const accepted = choice?.outcome === 'accepted';
    if (accepted) appInstalled = true;
    emit();
    return { installed: accepted, outcome: choice?.outcome || (accepted ? 'accepted' : 'dismissed') };
  } catch (error) {
    emit();
    return { installed: false, error, outcome: 'error' };
  }
}

export function usePWAInstall() {
  const [state, setState] = useState(() => snapshot());

  useEffect(() => {
    bindGlobalInstallListeners();
    const subscriber = (next) => setState(next);
    subscribers.add(subscriber);
    setState(snapshot());
    return () => subscribers.delete(subscriber);
  }, []);

  const install = async () => {
    const result = await promptPWAInstall();
    return result?.installed === true;
  };

  return {
    ...state,
    install,
    promptInstall: promptPWAInstall,
  };
}
