import {t} from './services__i18n.js?v=7.9.4.136-localization';
import { ModalLayer } from './components__common__ModalLayer.js?v=7.9.4.136-localization';
import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useApp } from './context__AppContext.js?v=7.9.4.136-localization';
import { Camera, X, AlertCircle, ScanLine } from 'lucide-react';

const h = React.createElement;

export const BarcodeCameraModal = ({ open, onClose, onDetected, title = 'مسح الباركود بالكاميرا', autoClose = false }) => {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const detectorRef = useRef(null);
  const rafRef = useRef(0);
  const busyRef = useRef(false);
  const lastCodeRef = useRef({ code:'', at:0 });
  const onDetectedRef = useRef(onDetected);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onDetectedRef.current = onDetected; }, [onDetected]);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  const [cameraError, setCameraError] = useState('');
  const [status, setStatus] = useState('جاري تشغيل الكاميرا...');

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let lastScanAt = 0;

    const stop = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
      const stream = streamRef.current;
      if (stream) stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    const finish = (code) => {
      const clean = String(code || '').trim();
      if (!clean || cancelled || busyRef.current) return;
      const now = Date.now();
      // منع تكرار نفس الباركود عشرات المرات أثناء بقائه أمام العدسة،
      // مع إبقاء الكاميرا مفتوحة للمسح المتتابع حتى يغلقها المستخدم بنفسه.
      if (lastCodeRef.current.code === clean && (now - lastCodeRef.current.at) < 1400) return;
      lastCodeRef.current = { code: clean, at: now };
      busyRef.current = true;
      setStatus(autoClose ? `تمت قراءة ${clean}` : `تمت قراءة ${clean} — الكاميرا ما زالت مفتوحة`);
      try { onDetectedRef.current?.(clean); } finally {
        if (autoClose) {
          stop();
          window.requestAnimationFrame(() => onCloseRef.current?.());
          return;
        }
        window.setTimeout(() => {
          if (!cancelled) {
            busyRef.current = false;
            setStatus('وجّه الباركود التالي داخل الإطار');
          }
        }, 420);
      }
    };

    const scanFrame = async (time) => {
      if (cancelled) return;
      rafRef.current = requestAnimationFrame(scanFrame);
      if (busyRef.current || !detectorRef.current || !videoRef.current || videoRef.current.readyState < 2) return;
      if (time - lastScanAt < 80) return;
      lastScanAt = time;
      try {
        const results = await detectorRef.current.detect(videoRef.current);
        const code = results?.find((x) => x?.rawValue)?.rawValue;
        if (code) finish(code);
      } catch { /* ignore transient frame errors */ }
    };

    const start = async () => {
      busyRef.current = false;
      setCameraError('');
      setStatus('جاري تشغيل الكاميرا...');
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('NO_CAMERA_API');
        if (!('BarcodeDetector' in window)) throw new Error('NO_BARCODE_DETECTOR');

        const supported = typeof window.BarcodeDetector.getSupportedFormats === 'function'
          ? await window.BarcodeDetector.getSupportedFormats().catch(() => [])
          : [];
        const wanted = ['ean_13', 'ean_8', 'code_128', 'code_39', 'upc_a', 'upc_e', 'itf', 'qr_code'];
        const formats = supported.length ? wanted.filter((f) => supported.includes(f)) : wanted;
        detectorRef.current = new window.BarcodeDetector(formats.length ? { formats } : undefined);

        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play();
        }

        const track = stream.getVideoTracks?.()[0];
        try {
          const caps = track?.getCapabilities?.();
          const advanced = [];
          if (caps?.focusMode?.includes?.('continuous')) advanced.push({ focusMode: 'continuous' });
          if (caps?.zoom && Number.isFinite(caps.zoom.min)) {
            const idealZoom = Math.min(caps.zoom.max || 1, Math.max(caps.zoom.min || 1, 1.35));
            advanced.push({ zoom: idealZoom });
          }
          if (advanced.length) await track.applyConstraints({ advanced }).catch(() => {});
        } catch { /* optional camera tuning */ }

        setStatus('وجّه الباركود داخل الإطار');
        rafRef.current = requestAnimationFrame(scanFrame);
      } catch (err) {
        const code = err?.message || '';
        if (code === 'NO_BARCODE_DETECTOR') {
          setCameraError('قارئ الباركود المباشر غير مدعوم في هذا المتصفح. افتح التطبيق في Chrome حديث على أندرويد.');
        } else if (err?.name === 'NotAllowedError') {
          setCameraError('تم رفض إذن الكاميرا. اسمح للتطبيق باستخدام الكاميرا ثم أعد المحاولة.');
        } else {
          setCameraError('تعذر تشغيل الكاميرا. تحقق من الإذن ومن أن الصفحة تعمل عبر HTTPS.');
        }
        setStatus('');
      }
    };

    lastCodeRef.current = { code:'', at:0 };
    start();
    return () => { cancelled = true; busyRef.current = false; stop(); };
  }, [open]);

  if (!open) return null;
  const overlay = h(ModalLayer, {
    className: 'barcode-camera-overlay fixed inset-0 flex items-center justify-center bg-black/80 p-3 animate-in fade-in',
    style: { zIndex: 2147483000 },
    onPointerDown: (e) => { if (e.target === e.currentTarget) onClose?.(); },
  },
    h('div', { className: 'w-full max-w-md overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl border border-slate-200 dark:border-slate-800 text-right' },
      h('div', { className: 'flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800' },
        h('div', { className: 'flex items-center gap-2' },
          h(Camera, { className: 'w-5 h-5 text-violet-600' }),
          h('div', null,
            h('h3', { className: 'font-black text-sm text-slate-900 dark:text-white' }, title),
            h('p', { className: 'text-[10px] text-slate-400 mt-0.5' }, status || 'قراءة تلقائية بدون إدخال يدوي')
          )
        ),
        h('button', { type: 'button', onClick: onClose, className: 'p-1.5 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800' }, h(X, { className: 'w-5 h-5' }))
      ),
      h('div', { className: 'relative aspect-[4/3] bg-black overflow-hidden' },
        cameraError
          ? h('div', { className: 'absolute inset-0 flex flex-col items-center justify-center text-center p-6 text-slate-200' },
              h(AlertCircle, { className: 'w-9 h-9 text-amber-400 mb-3' }),
              h('p', { className: 'text-xs leading-6' }, cameraError)
            )
          : h(React.Fragment, null,
              h('video', { ref: videoRef, className: 'w-full h-full object-cover', playsInline: true, muted: true, autoPlay: true }),
              h('div', { className: 'absolute inset-[12%] rounded-2xl border-2 border-violet-400/90 shadow-[0_0_0_999px_rgba(0,0,0,.22)] pointer-events-none' }),
              h('div', { className: 'absolute left-[16%] right-[16%] top-1/2 h-0.5 bg-violet-400 shadow-[0_0_12px_#A78BFA] animate-pulse pointer-events-none' }),
              h('div', { className: 'absolute bottom-3 left-0 right-0 flex justify-center pointer-events-none' },
                h('span', { className: 'inline-flex items-center gap-1.5 rounded-full bg-black/55 text-white px-3 py-1.5 text-[10px] font-bold backdrop-blur' },
                  h(ScanLine, { className: 'w-3.5 h-3.5 text-violet-300' }), 'مسح متتابع — الكاميرا تبقى مفتوحة حتى تضغط إغلاق'
                )
              )
            )
      ),
      cameraError && h('div', { className: 'p-3 flex justify-center bg-slate-50 dark:bg-slate-800/50' },
        h('button', { type: 'button', onClick: () => { onClose?.(); setTimeout(() => {}, 0); }, className: 'px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold' }, t("إغلاق"))
      )
    )
  );
  return typeof document !== 'undefined' ? createPortal(overlay, document.body) : overlay;
};

export const CameraScannerModal = () => {
  const { showCameraModal, setShowCameraModal, handleScannedBarcode } = useApp();
  return h(BarcodeCameraModal, {
    open: showCameraModal,
    onClose: () => setShowCameraModal(false),
    onDetected: (code) => handleScannedBarcode(code),
    title: 'ماسح باركود الكاشير',
  });
};
