/**
 * Web Audio API based sound synthesizer for POS scanner and actions.
 * Works 100% offline with zero external audio assets.
 */
let audioCtx = null;
function getAudioContext() {
    if (typeof window === 'undefined')
        return null;
    if (!audioCtx) {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (AudioContextClass) {
            audioCtx = new AudioContextClass();
        }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
    return audioCtx;
}
/**
 * High-pitch short crisp scanner beep (classic commercial POS sound)
 */
export function playBeepSound(enabled = true) {
    if (!enabled)
        return;
    try {
        const ctx = getAudioContext();
        if (!ctx)
            return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, ctx.currentTime); // 1.8kHz crisp POS beep
        osc.frequency.exponentialRampToValueAtTime(1900, ctx.currentTime + 0.06);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
    }
    catch {
        // Ignore audio autoplay restrictions
    }
}
/**
 * Pleasant success chime for completed sales/payments
 */
export function playSuccessSound(enabled = true) {
    if (!enabled)
        return;
    try {
        const ctx = getAudioContext();
        if (!ctx)
            return;
        const now = ctx.currentTime;
        const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6 major chord
        notes.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(freq, now + index * 0.05);
            gain.gain.setValueAtTime(0.12, now + index * 0.05);
            gain.gain.exponentialRampToValueAtTime(0.001, now + index * 0.05 + 0.2);
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.start(now + index * 0.05);
            osc.stop(now + index * 0.05 + 0.22);
        });
    }
    catch {
        // Ignore
    }
}
/**
 * Error / warning buzzer sound
 */
export function playErrorSound(enabled = true) {
    if (!enabled)
        return;
    try {
        const ctx = getAudioContext();
        if (!ctx)
            return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, ctx.currentTime);
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.2);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.22);
    }
    catch {
        // Ignore
    }
}
