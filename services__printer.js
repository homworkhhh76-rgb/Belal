/*
  Persistent ESC/POS printer manager.
  - A printer is selected from inside the app once, then remembered on this device/browser.
  - SPA navigation never tears down the connection.
  - If Android/Chrome suspends Bluetooth while the app is in the background, the manager reconnects silently.
  - Every print waits for a healthy connection and retries once after a transport failure.
  - Supports BLE printers with a writable GATT characteristic and Web Serial printers as a fallback.
*/
const PREF_KEY = 'oscar-accounting-printer-pref-v3';
const LEGACY_PREF_KEYS = ['oscar-accounting-printer-pref-v2','oscar-accounting-printer-pref-v1'];
const BLE_SERVICES = [
  '0000ffe0-0000-1000-8000-00805f9b34fb',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '000018f0-0000-1000-8000-00805f9b34fb',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2'
];

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const isVisible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';

class SmartPrinterManager {
  constructor() {
    this.mode = '';
    this.name = '';
    this.device = null;
    this.server = null;
    this.characteristic = null;
    this.port = null;
    this.listeners = new Set();
    this.connecting = '';
    this.lastError = '';
    this._writeQueue = Promise.resolve();
    this._reconnectTimer = null;
    this._disconnectDevice = null;
    this._disconnectHandler = null;
    this._started = false;

    this._migratePreference();
    if (typeof window !== 'undefined') this._startLifetimeManager();
  }

  _migratePreference() {
    try {
      if (!localStorage.getItem(PREF_KEY)) {
        for (const key of LEGACY_PREF_KEYS) {
          const legacy = localStorage.getItem(key);
          if (legacy) { localStorage.setItem(PREF_KEY, legacy); break; }
        }
      }
    } catch {}
  }

  _startLifetimeManager() {
    if (this._started) return;
    this._started = true;
    const wake = () => {
      if (!isVisible()) return;
      this.autoReconnect().catch(() => {});
    };
    window.addEventListener('pageshow', wake);
    window.addEventListener('focus', wake);
    window.addEventListener('online', wake);
    document.addEventListener('visibilitychange', wake);
    setTimeout(wake, 300);

    // Browsers may suspend a GATT link while the screen/app is in the background.
    // This loop restores the remembered printer silently when the app becomes active.
    this._reconnectTimer = setInterval(() => {
      if (!isVisible() || this.isConnected() || this.connecting) return;
      const pref = this._readPref();
      if (pref?.mode) this.autoReconnect().catch(() => {});
    }, 5000);
  }

  _readPref() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; } catch { return {}; }
  }
  _writePref(value) {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(value || {})); } catch {}
  }
  _emit() {
    const state = this.getState();
    this.listeners.forEach(fn => { try { fn(state); } catch {} });
  }
  subscribe(fn) {
    this.listeners.add(fn);
    try { fn(this.getState()); } catch {}
    return () => this.listeners.delete(fn);
  }

  isConnected() {
    if (this.mode === 'bluetooth') return !!this.device?.gatt?.connected && !!this.characteristic;
    if (this.mode === 'serial') return !!this.port?.writable;
    return false;
  }

  _platformInfo() {
    const ua = typeof navigator !== 'undefined' ? String(navigator.userAgent || '') : '';
    const platform = typeof navigator !== 'undefined' ? String(navigator.platform || '') : '';
    const touchPoints = typeof navigator !== 'undefined' ? Number(navigator.maxTouchPoints || 0) : 0;
    const isIOS = /iPad|iPhone|iPod/i.test(ua) || (/Mac/i.test(platform) && touchPoints > 1);
    const isMac = !isIOS && (/Macintosh|Mac OS X/i.test(ua) || /Mac/i.test(platform));
    const secureContext = typeof window === 'undefined' ? true : window.isSecureContext !== false;
    const bluetoothSupported = typeof navigator !== 'undefined' && !!navigator.bluetooth?.requestDevice && secureContext;
    const serialSupported = typeof navigator !== 'undefined' && !!navigator.serial?.requestPort && secureContext;
    return { isIOS, isMac, secureContext, bluetoothSupported, serialSupported };
  }

  getState() {
    const pref = this._readPref();
    const platform = this._platformInfo();
    const mode = this.mode || pref?.mode || '';
    const systemMode = mode === 'system';
    const connected = this.isConnected();
    return {
      connected,
      ready: connected || systemMode,
      systemMode,
      mode,
      name: this.name || (connected ? this.device?.name : '') || (systemMode ? (pref?.name || 'طباعة النظام') : ''),
      preferredName: pref?.name || '',
      hasRememberedPrinter: !!pref?.mode,
      connecting: this.connecting || '',
      lastError: this.lastError,
      bluetoothSupported: platform.bluetoothSupported,
      serialSupported: platform.serialSupported,
      secureContext: platform.secureContext,
      isIOS: platform.isIOS,
      isMac: platform.isMac,
      systemPrintSupported: typeof window !== 'undefined' && typeof window.print === 'function',
    };
  }

  async enableSystemPrint(name = '') {
    const platform = this._platformInfo();
    const label = name || (platform.isIOS ? 'iPhone / AirPrint / طباعة النظام' : platform.isMac ? 'macOS / طباعة النظام' : 'طباعة النظام');
    if (this.mode === 'bluetooth' && this.device?.gatt?.connected) { try { this.device.gatt.disconnect(); } catch {} }
    if (this.mode === 'serial' && this.port) { try { await this.port.close(); } catch {} }
    this.mode = 'system';
    this.name = label;
    this.device = null; this.server = null; this.characteristic = null; this.port = null;
    this.lastError = '';
    this._writePref({ mode:'system', name:label });
    this._emit();
    return this.getState();
  }

  async getRememberedBluetoothDevices() {
    if (!navigator.bluetooth?.getDevices) return [];
    try {
      const devices = await navigator.bluetooth.getDevices();
      return (devices || []).map(d => ({ id:d.id || '', name:d.name || 'Bluetooth Printer' }));
    } catch { return []; }
  }

  async connectBluetooth() {
    const platform = this._platformInfo();
    // Safari/iPhone does not expose Web Bluetooth. Do not hide/disable the printer button:
    // switch to the operating-system print path so paired/AirPrint/driver printers remain usable.
    if (!platform.bluetoothSupported) return this.enableSystemPrint();
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_SERVICES
    });
    return this._attachBluetooth(device, true);
  }

  async connectRememberedBluetooth(deviceId = '') {
    if (!navigator.bluetooth?.getDevices) throw new Error('المتصفح لا يسمح بإعادة الاتصال التلقائي بهذه الطابعة.');
    const pref = this._readPref();
    const devices = await navigator.bluetooth.getDevices();
    const targetId = deviceId || pref?.deviceId || '';
    const target = (devices || []).find(d => d.id === targetId) || (pref?.name ? (devices || []).find(d => d.name === pref.name) : null);
    if (!target) throw new Error('الطابعة المحفوظة غير متاحة. اخترها مرة أخرى من زر اختيار الطابعة.');
    return this._attachBluetooth(target, false);
  }

  _bindBluetoothDisconnect(device) {
    if (!device || this._disconnectDevice === device) return;
    if (this._disconnectDevice && this._disconnectHandler) {
      try { this._disconnectDevice.removeEventListener('gattserverdisconnected', this._disconnectHandler); } catch {}
    }
    this._disconnectDevice = device;
    this._disconnectHandler = () => {
      if (this.device !== device) return;
      this.characteristic = null;
      this.server = null;
      this.lastError = '';
      this._emit();
      setTimeout(() => this.autoReconnect().catch(() => {}), 500);
    };
    try { device.addEventListener('gattserverdisconnected', this._disconnectHandler); } catch {}
  }

  async _findWritableCharacteristic(server) {
    let characteristic = null;
    let services = [];
    try { services = await server.getPrimaryServices(); } catch {}
    for (const service of services) {
      try {
        const chars = await service.getCharacteristics();
        characteristic = chars.find(c => c.properties?.writeWithoutResponse) ||
                         chars.find(c => c.properties?.write) || characteristic;
        if (characteristic) break;
      } catch {}
    }
    return characteristic;
  }

  async _attachBluetooth(device, remember = true) {
    if (!device?.gatt) throw new Error('الطابعة المختارة لا توفر اتصال Bluetooth GATT متوافق.');
    if (this.connecting) {
      for (let i=0; i<40 && this.connecting; i++) await sleep(100);
      if (this.isConnected() && this.device?.id === device.id) return this.getState();
    }
    this.connecting = 'bluetooth';
    this.lastError = '';
    this._emit();
    try {
      if (this.device && this.device !== device && this.device?.gatt?.connected) {
        try { this.device.gatt.disconnect(); } catch {}
      }
      let server = device.gatt.connected ? device.gatt : await device.gatt.connect();
      let characteristic = await this._findWritableCharacteristic(server);
      if (!characteristic) {
        // Some Android stacks need one fresh GATT session after permission is granted.
        try { device.gatt.disconnect(); } catch {}
        await sleep(250);
        server = await device.gatt.connect();
        characteristic = await this._findWritableCharacteristic(server);
      }
      if (!characteristic) throw new Error('تم الاتصال بالطابعة لكن لم يتم العثور على قناة كتابة ESC/POS متوافقة.');

      this.mode = 'bluetooth';
      this.device = device;
      this.server = server;
      this.characteristic = characteristic;
      this.port = null;
      this.name = device.name || 'Bluetooth Printer';
      this._bindBluetoothDisconnect(device);
      if (remember) this._writePref({ mode:'bluetooth', deviceId:device.id || '', name:this.name });
      this.lastError = '';
      this._emit();
      return this.getState();
    } catch (err) {
      this.characteristic = null;
      this.server = null;
      this.lastError = err?.message || String(err);
      this._emit();
      throw err;
    } finally {
      this.connecting = '';
      this._emit();
    }
  }

  async connectSerial() {
    const platform = this._platformInfo();
    if (!platform.serialSupported) return this.enableSystemPrint();
    const port = await navigator.serial.requestPort();
    return this._attachSerial(port, true);
  }

  _serialIdentity(port) {
    try {
      const info = port?.getInfo?.() || {};
      return { usbVendorId: info.usbVendorId ?? null, usbProductId: info.usbProductId ?? null };
    } catch { return { usbVendorId:null, usbProductId:null }; }
  }

  async _attachSerial(port, remember = true) {
    if (this.connecting) {
      for (let i=0; i<40 && this.connecting; i++) await sleep(100);
      if (this.isConnected() && this.port === port) return this.getState();
    }
    this.connecting = 'serial';
    this.lastError = '';
    this._emit();
    try {
      if (!port.readable && !port.writable) await port.open({ baudRate: 9600 });
      this.mode = 'serial';
      this.port = port;
      this.device = null;
      this.server = null;
      this.characteristic = null;
      const id = this._serialIdentity(port);
      this.name = 'Serial / Bluetooth Printer';
      if (remember) this._writePref({ mode:'serial', name:this.name, ...id });
      this.lastError = '';
      this._emit();
      return this.getState();
    } catch (err) {
      this.lastError = err?.message || String(err);
      this._emit();
      throw err;
    } finally {
      this.connecting = '';
      this._emit();
    }
  }

  async autoReconnect({ retries = 2 } = {}) {
    if (this.isConnected()) return this.getState();
    if (this.connecting) {
      for (let i=0; i<50 && this.connecting; i++) await sleep(100);
      return this.getState();
    }
    const pref = this._readPref();
    if (!pref?.mode) return this.getState();
    if (pref.mode === 'system') {
      this.mode = 'system';
      this.name = pref.name || 'طباعة النظام';
      this.lastError = '';
      this._emit();
      return this.getState();
    }

    let lastErr = null;
    for (let attempt=0; attempt<Math.max(1,retries); attempt++) {
      try {
        if (pref.mode === 'bluetooth' && navigator.bluetooth?.getDevices) {
          const devices = await navigator.bluetooth.getDevices();
          // Never connect to a random permitted device. Only the saved printer is allowed.
          const device = (devices || []).find(d => d.id === pref.deviceId) ||
                         (pref.name ? (devices || []).find(d => d.name === pref.name) : null);
          if (device) return await this._attachBluetooth(device, false);
        }
        if (pref.mode === 'serial' && navigator.serial?.getPorts) {
          const ports = await navigator.serial.getPorts();
          const exact = (ports || []).find(p => {
            const id = this._serialIdentity(p);
            return (pref.usbVendorId == null || id.usbVendorId === pref.usbVendorId) &&
                   (pref.usbProductId == null || id.usbProductId === pref.usbProductId);
          });
          if (exact) return await this._attachSerial(exact, false);
        }
      } catch (err) {
        lastErr = err;
      }
      await sleep(350 * (attempt + 1));
    }
    if (lastErr) {
      this.lastError = lastErr?.message || String(lastErr);
      this._emit();
    }
    return this.getState();
  }

  async ensureConnected() {
    if (this.isConnected()) return this.getState();
    await this.autoReconnect({ retries:3 });
    const state = this.getState();
    if (state.systemMode) { const err = new Error('SYSTEM_PRINT_REQUIRED'); err.code = 'SYSTEM_PRINT_REQUIRED'; throw err; }
    if (!this.isConnected()) throw new Error('الطابعة المحفوظة غير متصلة. اختر الطابعة مرة واحدة من الإعدادات.');
    return this.getState();
  }

  async disconnect({ forget = true } = {}) {
    try {
      if (this.mode === 'bluetooth' && this.device?.gatt?.connected) {
        try { this.device.gatt.disconnect(); } catch {}
      }
      if (this.mode === 'serial' && this.port) {
        try { await this.port.close(); } catch {}
      }
    } finally {
      this.mode = '';
      this.name = '';
      this.device = null;
      this.server = null;
      this.characteristic = null;
      this.port = null;
      if (forget) this._writePref({});
      this._emit();
    }
  }

  async _writeBluetooth(data) {
    const characteristic = this.characteristic;
    if (!characteristic) throw new Error('قناة الطابعة غير متاحة.');
    const fn = characteristic.writeValueWithoutResponse ? 'writeValueWithoutResponse' : 'writeValue';
    // 96 bytes + a short pause is intentionally conservative; it is substantially more reliable
    // with low-cost ESC/POS BLE printers than flooding their small receive buffer.
    let chunkSize = 96;
    for (let i=0; i<data.length; i+=chunkSize) {
      const chunk = data.slice(i, i+chunkSize);
      try {
        await characteristic[fn](chunk);
      } catch (err) {
        // A few older BLE printers expose a very small MTU. Retry the same chunk as 20-byte packets.
        if (chunkSize > 20 && this.device?.gatt?.connected) {
          for (let j=0; j<chunk.length; j+=20) {
            await characteristic[fn](chunk.slice(j, j+20));
            await sleep(6);
          }
        } else throw err;
      }
      await sleep(8);
    }
  }

  async _writeSerial(data) {
    if (!this.port?.writable) throw new Error('منفذ الطابعة غير متاح.');
    const writer = this.port.writable.getWriter();
    try {
      for (let i=0; i<data.length; i+=1024) {
        await writer.write(data.slice(i, i+1024));
        if (data.length > 4096) await sleep(4);
      }
    } finally {
      writer.releaseLock();
    }
  }

  async _writeBytesInternal(data) {
    await this.ensureConnected();
    try {
      if (this.mode === 'bluetooth') await this._writeBluetooth(data);
      else if (this.mode === 'serial') await this._writeSerial(data);
      else throw new Error('لا توجد طابعة متصلة.');
      this.lastError = '';
      this._emit();
      return true;
    } catch (firstErr) {
      // Do not make the cashier re-select a printer for a normal Android background disconnect.
      if (this.mode === 'bluetooth') {
        this.characteristic = null;
        this.server = null;
      }
      this._emit();
      await sleep(250);
      await this.autoReconnect({ retries:3 });
      if (!this.isConnected()) throw firstErr;
      if (this.mode === 'bluetooth') await this._writeBluetooth(data);
      else if (this.mode === 'serial') await this._writeSerial(data);
      this.lastError = '';
      this._emit();
      return true;
    }
  }

  async writeBytes(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
    // Serialize print jobs to prevent two invoices from interleaving on the same Bluetooth stream.
    const job = this._writeQueue.then(() => this._writeBytesInternal(data));
    this._writeQueue = job.catch(() => {});
    return job;
  }

  _canvasToRaster(canvas, paperWidth='80mm') {
    const maxWidth = paperWidth === '58mm' ? 384 : 576;
    const scale = Math.min(1, maxWidth / Math.max(1, canvas.width));
    const width = Math.max(8, Math.floor(canvas.width * scale / 8) * 8);
    const height = Math.max(1, Math.floor(canvas.height * (width / canvas.width)));
    const c = document.createElement('canvas'); c.width = width; c.height = height;
    const ctx = c.getContext('2d', { willReadFrequently:true });
    ctx.fillStyle = '#fff'; ctx.fillRect(0,0,width,height); ctx.drawImage(canvas,0,0,width,height);
    const rgba = ctx.getImageData(0,0,width,height).data;
    const bytesPerRow = width >> 3;
    const raster = new Uint8Array(bytesPerRow * height);
    for (let y=0; y<height; y++) {
      for (let xb=0; xb<bytesPerRow; xb++) {
        let b = 0;
        for (let bit=0; bit<8; bit++) {
          const x = xb*8 + bit, o = (y*width+x)*4;
          const gray = rgba[o]*0.299 + rgba[o+1]*0.587 + rgba[o+2]*0.114;
          if (rgba[o+3] > 20 && gray < 190) b |= (0x80 >> bit);
        }
        raster[y*bytesPerRow+xb] = b;
      }
    }
    const xL=bytesPerRow&255, xH=(bytesPerRow>>8)&255, yL=height&255, yH=(height>>8)&255;
    const header = new Uint8Array([0x1b,0x40,0x1b,0x61,0x01,0x1d,0x76,0x30,0x00,xL,xH,yL,yH]);
    const footer = new Uint8Array([0x0a,0x0a,0x0a,0x1d,0x56,0x00]);
    const out = new Uint8Array(header.length+raster.length+footer.length);
    out.set(header,0); out.set(raster,header.length); out.set(footer,header.length+raster.length);
    return out;
  }

  async printCanvas(canvas, { paperWidth='80mm' }={}) {
    if (!canvas) throw new Error('تعذر تجهيز الفاتورة للطباعة.');
    if (this.getState().systemMode) { const err = new Error('SYSTEM_PRINT_REQUIRED'); err.code = 'SYSTEM_PRINT_REQUIRED'; throw err; }
    const bytes = this._canvasToRaster(canvas, paperWidth);
    await this.writeBytes(bytes);
    return true;
  }
}

export const smartPrinter = (typeof window !== 'undefined' && window.__OSCAR_ACCOUNTING_PRINTER__) || new SmartPrinterManager();
if (typeof window !== 'undefined') window.__OSCAR_ACCOUNTING_PRINTER__ = smartPrinter;
