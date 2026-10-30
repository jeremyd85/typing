const LOOKAHEAD = 0.01;
const ATTACK = 0.008;
const RELEASE = 0.02;
const MAX_VOICES = 6;

let context = null;
let bus = null;
let enabled = false;
let voices = 0;

export function setEnabled(value) {
  enabled = value;
}

export function isEnabled() {
  return enabled;
}

function audio() {
  if (!enabled) return null;

  const Ctor = window.AudioContext ?? window.webkitAudioContext;
  if (!Ctor) return null;

  if (context === null) {
    context = new Ctor();
    bus = context.createGain();
    bus.gain.value = 0.4;
    bus.connect(context.destination);
  }

  if (context.state !== 'running') context.resume();
  return context;
}

function tone({ frequency, peak, seconds, delay = 0 }) {
  const ctx = audio();
  if (!ctx || voices >= MAX_VOICES) return;

  const start = ctx.currentTime + LOOKAHEAD + delay;
  const stop = start + seconds;

  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, start);

  gain.gain.setValueAtTime(0, start);
  gain.gain.linearRampToValueAtTime(peak, start + ATTACK);
  gain.gain.setTargetAtTime(0, start + ATTACK, seconds / 4);
  gain.gain.linearRampToValueAtTime(0, stop + RELEASE);

  oscillator.connect(gain).connect(bus);
  oscillator.start(start);
  oscillator.stop(stop + RELEASE);

  voices += 1;
  oscillator.onended = () => {
    voices -= 1;
    oscillator.disconnect();
    gain.disconnect();
  };
}

export function thud() {
  tone({ frequency: 174.61, peak: 0.15, seconds: 0.13 });
  tone({ frequency: 349.23, peak: 0.05, seconds: 0.1 });
}

export function blip() {
  tone({ frequency: 880, peak: 0.09, seconds: 0.05 });
}

export function chime() {
  tone({ frequency: 880, peak: 0.09, seconds: 0.07 });
  tone({ frequency: 1318.51, peak: 0.07, seconds: 0.1, delay: 0.065 });
}
