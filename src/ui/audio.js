export class AudioEngine {
  constructor(enabled = true) {
    this.enabled = enabled;
    this.context = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled && this.context) this.context.suspend();
    if (enabled && this.context) this.context.resume();
  }

  ensure() {
    if (!this.enabled) return null;
    if (!this.context) this.context = new (window.AudioContext || window.webkitAudioContext)();
    if (this.context.state === 'suspended') this.context.resume();
    return this.context;
  }

  play(kind = 'click') {
    const context = this.ensure();
    if (!context) return;
    const patterns = {
      click: [[440, 0, 0.05]],
      sail: [[330, 0, 0.08], [494, 0.06, 0.12]],
      build: [[262, 0, 0.08], [392, 0.08, 0.10], [523, 0.16, 0.15]],
      discovery: [[523, 0, 0.10], [659, 0.08, 0.12], [784, 0.16, 0.20]],
      impact: [[130, 0, 0.12], [82, 0.06, 0.18]],
      tide: [[294, 0, 0.18], [440, 0.12, 0.24]],
      victory: [[392, 0, 0.15], [523, 0.12, 0.15], [659, 0.24, 0.18], [784, 0.38, 0.35]]
    };
    for (const [frequency, delay, duration] of patterns[kind] || patterns.click) {
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === 'impact' ? 'sawtooth' : 'sine';
      oscillator.frequency.value = frequency;
      const start = context.currentTime + delay;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(kind === 'impact' ? 0.08 : 0.045, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.02);
    }
  }
}
