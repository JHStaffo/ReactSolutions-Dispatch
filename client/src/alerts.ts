// Audible and desktop alerts for things a dispatcher must not miss.
// Notification text carries call numbers only, never patient details (it can show on a locked screen).

const KEY = 'rsd-alerts';

export function alertsEnabled(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setAlertsEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
  if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

let ctx: AudioContext | null = null;

function beep(pattern: number[], freq: number) {
  try {
    ctx ||= new AudioContext();
    let t = ctx.currentTime;
    for (const ms of pattern) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = freq;
      o.type = 'square';
      g.gain.setValueAtTime(0.08, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + ms / 1000);
      t += ms / 1000 + 0.08;
    }
  } catch {
    /* audio not available */
  }
}

export function raiseAlert(kind: 'asap' | 'late' | 'info', text: string) {
  if (!alertsEnabled()) return;
  if (kind === 'asap') beep([180, 180, 180], 880);
  else if (kind === 'late') beep([350], 520);
  else beep([120], 660);
  if ('Notification' in window && Notification.permission === 'granted' && document.visibilityState !== 'visible') {
    try {
      new Notification('Dispatch', { body: text, tag: text, silent: true });
    } catch {
      /* ignore */
    }
  }
}
