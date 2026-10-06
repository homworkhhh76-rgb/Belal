import './utils__overlayGuard.js?v=7.9.4.136-localization';
import { jsx as _jsx } from "react/jsx-runtime";
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js?v=7.9.4.136-localization';

class OscarErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false, healing: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error, info) {
    try { console.error('OSCAR_RENDER_ERROR', error, info); } catch (_) {}
    // A stale Service Worker can mix module versions on localhost/PWA upgrades.
    // Heal code caches once without touching IndexedDB/company data.
    try {
      const build = '7.9.4.136-localization';
      const key = 'oscar-render-heal-' + build;
      if (sessionStorage.getItem(key) !== '1') {
        sessionStorage.setItem(key, '1');
        this.setState({ healing: true });
        Promise.resolve().then(async () => {
          try {
            if ('caches' in window) {
              const keys = await caches.keys();
              await Promise.all(keys.filter((name) => name.startsWith('oscar-accounting-')).map((name) => caches.delete(name)));
            }
          } catch (_) {}
          try {
            if ('serviceWorker' in navigator) {
              const regs = await navigator.serviceWorker.getRegistrations();
              await Promise.all(regs.map((r) => r.unregister()));
            }
          } catch (_) {}
          const url = new URL(location.href);
          url.searchParams.set('_oscar_heal', Date.now().toString());
          location.replace(url.href);
        });
      }
    } catch (_) {}
  }
  render() {
    if (!this.state.failed) return this.props.children;
    if (this.state.healing) return React.createElement('div', { dir:'rtl', style:{minHeight:'100vh',display:'grid',placeItems:'center',background:'#f8fafc',fontFamily:'Cairo,sans-serif'} }, React.createElement('div',{style:{textAlign:'center',color:'#475569',fontWeight:800}},'جارٍ إصلاح الواجهة...'));
    return React.createElement('div', {
      dir: 'rtl',
      style: {
        minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '24px', background: '#f8fafc', fontFamily: 'Cairo, sans-serif'
      }
    }, React.createElement('div', {
      style: { width: '100%', maxWidth: '420px', textAlign: 'center', background: '#fff', borderRadius: '20px', padding: '24px', border: '1px solid #e2e8f0' }
    },
      React.createElement('div', { style: { fontSize: '34px', marginBottom: '8px' } }, '🔄'),
      React.createElement('div', { style: { fontWeight: 900, color: '#0f172a', marginBottom: '8px' } }, 'إعادة تحميل واجهة النظام'),
      React.createElement('div', { style: { fontSize: '12px', color: '#64748b', marginBottom: '16px' } }, 'بياناتك محفوظة. أعد تحميل الواجهة فقط.'),
      React.createElement('button', {
        onClick: () => location.reload(),
        style: { border: 0, borderRadius: '12px', background: '#7C3AED', color: '#fff', padding: '11px 18px', fontWeight: 800, cursor: 'pointer' }
      }, 'إعادة التحميل')
    ));
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) throw new Error('ROOT_NOT_FOUND');

// Production kiosk/POS render: avoid StrictMode's development-only double effect cycle.
createRoot(rootElement).render(_jsx(OscarErrorBoundary, { children: _jsx(App, {}) }));
