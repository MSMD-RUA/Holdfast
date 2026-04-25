/**
 * <holdfast-gate> — Web Component
 *
 * A custom element wrapping HoldfastGate. Framework-agnostic.
 * Works in vanilla HTML, Vue, Svelte, Angular, or any context that
 * supports custom elements.
 *
 * @example — HTML
 * <holdfast-gate label="Delete account" severity="critical">
 *   <button>Delete Account</button>
 * </holdfast-gate>
 *
 * <script>
 *   document.querySelector('holdfast-gate')
 *     .addEventListener('hf:grant',  () => deleteAccount())
 *     .addEventListener('hf:breach', e  => console.log('Cooldown:', e.detail.lockRemaining))
 * </script>
 *
 * @example — programmatic
 * const el = document.createElement('holdfast-gate');
 * el.label    = 'Force push to main';
 * el.severity = 'critical';
 * el.addEventListener('hf:grant', () => forcePush());
 * document.body.appendChild(el);
 * el.open();
 *
 * Attributes / Properties
 *   label       string   — action description shown in overlay
 *   severity    string   — 'caution' | 'danger' | 'critical'
 *   sync-ms     number   — override sync hold duration (ms)
 *   commit-ms   number   — override commit hold duration (ms)
 *   window-ms   number   — override privilege window (ms)
 *   lock-ms     number   — override first breach cooldown (ms)
 *   storage-key string   — localStorage persistence key
 *   open        boolean  — reflects open state (also an attr)
 *
 * Dispatched events (all bubble, composed)
 *   hf:grant    — permission earned — detail: GateSnapshot
 *   hf:breach   — breach occurred   — detail: GateSnapshot
 *   hf:sync     — sync achieved     — detail: GateSnapshot
 *   hf:locked   — cooldown started  — detail: GateSnapshot
 *   hf:expired  — LIVE ended        — detail: GateSnapshot
 *   hf:cancel   — user cancelled    — detail: null
 */

import { HoldfastGate, State, DEFAULTS } from '@holdgate/core';

const SEVERITY_PRESETS = {
  caution : { syncMs: 600,  commitMs: 1200, lockMs:  4000, hardLockMs: 12000, windowMs: 12000 },
  danger  : { syncMs: 800,  commitMs: 2200, lockMs:  8000, hardLockMs: 20000, windowMs: 15000 },
  critical: { syncMs: 800,  commitMs: 3500, lockMs: 20000, hardLockMs: 40000, windowMs: 15000 },
};

const OBSERVED = ['label', 'severity', 'sync-ms', 'commit-ms', 'window-ms', 'lock-ms', 'storage-key'];

class HoldfastGateElement extends HTMLElement {

  static get observedAttributes() { return OBSERVED; }

  constructor() {
    super();
    this._gate   = null;
    this._raf    = null;
    this._shadow = this.attachShadow({ mode: 'open' });
    this._open   = false;
    this._holding   = false;
    this._holdStart = 0;
  }

  connectedCallback() {
    this._render();
    this._shadow.querySelector('slot')?.addEventListener('click', () => this.open());
  }

  disconnectedCallback() {
    this._close(false);
  }

  attributeChangedCallback() {
    if (this._open) this._renderOverlay();
  }

  // ── Public API ─────────────────────────────────────────────────────────

  open() {
    if (this._open) return;
    this._open = true;
    this._buildGate();
    this._renderOverlay();
    this._startLoop();
    this.setAttribute('open', '');
    // Keyboard
    this._onKeyDown = (e) => {
      if (e.key === 'Escape') this._close(true);
      if (e.key === 'Enter' || e.key === ' ') this._kbHold();
    };
    this._onKeyUp = (e) => {
      if (e.key === 'Enter' || e.key === ' ') this._kbRelease();
    };
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup',   this._onKeyUp);
  }

  close() { this._close(true); }

  // ── Private ────────────────────────────────────────────────────────────

  _buildGate() {
    const preset = SEVERITY_PRESETS[this.getAttribute('severity')] ?? SEVERITY_PRESETS.danger;
    const opts = {
      ...preset,
      ...(this.getAttribute('sync-ms')    && { syncMs    : +this.getAttribute('sync-ms')    }),
      ...(this.getAttribute('commit-ms')  && { commitMs  : +this.getAttribute('commit-ms')  }),
      ...(this.getAttribute('window-ms')  && { windowMs  : +this.getAttribute('window-ms')  }),
      ...(this.getAttribute('lock-ms')    && { lockMs    : +this.getAttribute('lock-ms')    }),
      ...(this.getAttribute('storage-key')&& { storageKey: this.getAttribute('storage-key') }),
    };

    this._gate = new HoldfastGate(opts);

    this._gate.on('grant',  (d) => {
      this._dispatch('hf:grant', d);
      setTimeout(() => this._close(false), 600);
    });
    this._gate.on('breach',  (d) => this._dispatch('hf:breach', d));
    this._gate.on('sync',    (d) => this._dispatch('hf:sync',   d));
    this._gate.on('locked',  (d) => this._dispatch('hf:locked', d));
    this._gate.on('expired', (d) => this._dispatch('hf:expired',d));
  }

  _startLoop() {
    const loop = () => {
      if (!this._gate) return;
      this._gate.tick();
      this._updateOverlay(this._gate.snapshot());
      this._raf = requestAnimationFrame(loop);
    };
    this._raf = requestAnimationFrame(loop);
  }

  _close(cancel = true) {
    this._open = false;
    cancelAnimationFrame(this._raf);
    this._gate?.removeAllListeners();
    this._gate   = null;
    this._holding = false;
    this.removeAttribute('open');
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup',   this._onKeyUp);
    const overlay = this._shadow.querySelector('.hf-overlay');
    overlay?.remove();
    if (cancel) this._dispatch('hf:cancel', null);
  }

  _render() {
    this._shadow.innerHTML = `
      <style>
        :host { display: contents; }
        .hf-overlay {
          position: fixed; inset: 0; z-index: 9999;
          display: flex; align-items: center; justify-content: center; flex-direction: column;
          background: rgba(4,6,10,0.88); backdrop-filter: blur(6px);
          user-select: none; touch-action: none; cursor: pointer;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
        }
        .hf-card {
          display: flex; flex-direction: column; align-items: center; gap: 16px;
          padding: 36px 40px;
          background: rgba(10,14,22,0.92);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          max-width: 380px; width: 90vw;
          box-shadow: 0 24px 80px rgba(0,0,0,0.6);
        }
        .hf-state { font-size: 10px; letter-spacing: .12em; opacity: .70; color: #50B4FF; }
        .hf-label { font-size: 13px; color: rgba(220,230,250,.80); text-align: center; }
        .hf-hint  { font-size: 11px; color: rgba(180,190,220,.45); letter-spacing:.04em; min-height:18px; }
        .hf-hint.warn { color: rgba(240,160,60,.80); }
        .hf-cancel {
          margin-top: 8px; background: none; border: none; cursor: pointer;
          color: rgba(180,190,220,.30); font-size: 11px; letter-spacing:.04em;
          font-family: inherit; padding: 6px 12px; border-radius: 4px;
        }
        .hf-cancel:hover { color: rgba(180,190,220,.65); }
        canvas { display: block; }
      </style>
      <slot></slot>
    `;
  }

  _renderOverlay() {
    const existing = this._shadow.querySelector('.hf-overlay');
    if (existing) existing.remove();

    const label = this.getAttribute('label') || 'Confirm action';

    const overlay = document.createElement('div');
    overlay.className = 'hf-overlay';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `Confirm: ${label}`);

    overlay.innerHTML = `
      <div class="hf-card">
        <div class="hf-state">HOLD</div>
        <canvas width="280" height="280" style="width:140px;height:140px" aria-hidden="true"></canvas>
        <div class="hf-label">${label}</div>
        <div class="hf-hint">Hold to sync</div>
      </div>
      <button class="hf-cancel">ESC to cancel</button>
    `;

    overlay.addEventListener('pointerdown', (e) => {
      overlay.setPointerCapture(e.pointerId);
      this._gate?.hold(e.clientX, e.clientY);
      this._holding   = true;
      this._holdStart = performance.now();
    });
    overlay.addEventListener('pointermove', (e) => this._gate?.move(e.clientX, e.clientY));
    overlay.addEventListener('pointerup',   () => { this._gate?.release(); this._holding = false; });
    overlay.addEventListener('pointercancel',() => { this._gate?.release(); this._holding = false; });

    overlay.querySelector('.hf-cancel').addEventListener('click', () => this._close(true));
    overlay.querySelector('.hf-cancel').addEventListener('pointerdown', (e) => e.stopPropagation());

    this._shadow.appendChild(overlay);

    // Store canvas context for animation
    this._canvas2d = overlay.querySelector('canvas').getContext('2d');
  }

  _updateOverlay(snap) {
    const overlay = this._shadow.querySelector('.hf-overlay');
    if (!overlay) return;

    const stateEl = overlay.querySelector('.hf-state');
    const hintEl  = overlay.querySelector('.hf-hint');

    const stateText =
      snap.state === State.LIVE   ? 'AUTHORISED' :
      snap.state === State.LOCKED ? 'LOCKED'     :
      snap.state === State.PRIMED ? 'SYNCED'     : 'HOLD';

    const hintText =
      snap.state === State.LIVE   ? 'Authorised'                                       :
      snap.state === State.LOCKED ? `Locked — ${Math.ceil(snap.lockRemaining/1000)}s`  :
      snap.state === State.PRIMED ? 'Hold to confirm'                                  :
      'Hold to sync';

    const accent =
      snap.state === State.LIVE   ? '#FFCA3A' :
      snap.state === State.LOCKED ? '#F07828' :
      snap.synced                 ? '#FFCA3A' : '#50B4FF';

    if (stateEl) { stateEl.textContent = stateText; stateEl.style.color = accent; }
    if (hintEl)  {
      hintEl.textContent = hintText;
      hintEl.classList.toggle('warn', snap.state === State.LOCKED);
    }

    // Simple canvas draw (lightweight — no React dependency)
    this._drawCanvas(snap, accent);
  }

  _drawCanvas(snap, accent) {
    const ctx = this._canvas2d;
    if (!ctx) return;
    const S  = 140;
    const cx = S / 2, cy = S / 2;
    const TAU = Math.PI * 2;

    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, S, S);

    const [cR, cG, cB] = accent.startsWith('#')
      ? [parseInt(accent.slice(1,3),16), parseInt(accent.slice(3,5),16), parseInt(accent.slice(5,7),16)]
      : [80, 180, 255];

    const holdMs  = this._holding ? (performance.now() - this._holdStart) : 0;
    const reqMs   = snap.synced ? snap.commitMs : snap.syncMs;
    const chargeP = (this._holding && snap.state !== 'LOCKED' && !snap.live)
      ? Math.min(1, holdMs / reqMs) : 0;
    const arcR    = S * 0.34;

    // Track
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, 0, TAU);
    ctx.strokeStyle = `rgba(${cR},${cG},${cB},0.10)`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // Arc
    if (chargeP > 0.01 || snap.live) {
      const sweep = snap.live ? TAU : chargeP * TAU;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, -Math.PI/2, -Math.PI/2 + sweep);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${snap.live ? 0.88 : 0.55 + chargeP * 0.40})`;
      ctx.lineWidth = 2.0;
      ctx.stroke();
    }

    // Core
    const dotR = snap.live ? 4.0 : 2.0 + chargeP * 2.0;
    ctx.beginPath();
    ctx.arc(cx, cy, dotR, 0, TAU);
    ctx.fillStyle = `rgba(${cR},${cG},${cB},${snap.live ? 0.90 : 0.45 + chargeP * 0.50})`;
    ctx.fill();
  }

  _kbHold() {
    this._gate?.hold(window.innerWidth / 2, window.innerHeight / 2);
    this._holding   = true;
    this._holdStart = performance.now();
  }

  _kbRelease() {
    this._gate?.release();
    this._holding = false;
  }

  _dispatch(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

customElements.define('holdfast-gate', HoldfastGateElement);

export { HoldfastGateElement };
