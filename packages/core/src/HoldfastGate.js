/**
 * HoldfastGate.js
 *
 * A behavioural confirmation engine. Gates privileged actions behind a
 * sustained, steady hold — proving calm, deliberate intent at the moment
 * of consequence.
 *
 * Not identity-based (password). Not possession-based (token).
 * State-based: are you composed enough, right now, to act?
 *
 * ── State machine ──────────────────────────────────────────────────────────
 *
 *   IDLE    No engagement. Default state. Also returned to after expiry.
 *   PRIMED  Sync hold passed. User has demonstrated presence. Ready to commit.
 *   LIVE    Commit hold passed. Privilege window open. Lasts windowMs.
 *   LOCKED  Breach penalty active. Cooldown running. Try again after lockMs.
 *
 *   IDLE → (sync hold) → PRIMED → (commit hold) → LIVE → (expiry) → IDLE
 *                                       ↓ breach
 *                                     LOCKED → IDLE
 *
 * ── Two-stage design ───────────────────────────────────────────────────────
 *
 *   Stage 1 — Sync  (syncMs, default 800ms):
 *     Prove you are present. Short hold, steady pointer, no jitter.
 *     Fail is silent — no penalty, just try again.
 *     Pass → PRIMED.
 *
 *   Stage 2 — Commit  (commitMs, default 1600ms, adaptive):
 *     Prove you are deliberate. Longer hold, same steadiness requirement.
 *     Fail → BREACH + cooldown + tension accumulation.
 *     Pass → LIVE. Privilege window opens.
 *
 * ── Adaptive commit duration ───────────────────────────────────────────────
 *
 *   Every GRANT increases commitMs:
 *     +commitGrowMs    per grant (default +1000ms)
 *     +commitGrowBonusMs if re-granted within quickReformMs (default +600ms)
 *
 *   Ceiling: commitMsMax (default 6500ms).
 *   Decay: if LIVE hasn't been reached in commitDecayMs (default 60s),
 *          commitMs drops by commitDecayStepMs toward commitMsMin.
 *
 *   Effect: frequent users earn harder. Occasional users aren't punished.
 *   Prevents farming (hold minimum, wait, repeat).
 *
 * ── Breach and tension ─────────────────────────────────────────────────────
 *
 *   First breach:   lockMs cooldown (default 6s)
 *   Repeat breach:  hardLockMs cooldown (default 20s)
 *   Jitter penalty: up to +50% added to cooldown if pointer was moving
 *   Tension:        compound score 0–1, increases per breach, available
 *                   for UI to signal escalating warning state
 *   Escalation:     breach count 0–escalationCap (default 8), decays
 *                   after escalationDecayMs without a breach
 *
 * ── Events ─────────────────────────────────────────────────────────────────
 *
 *   gate.on('sync',    snap => {})   // PRIMED reached
 *   gate.on('grant',   snap => {})   // LIVE reached — execute action here
 *   gate.on('breach',  snap => {})   // breach occurred
 *   gate.on('expired', snap => {})   // LIVE window ended
 *   gate.on('locked',  snap => {})   // cooldown started
 *   gate.on('change',  snap => {})   // any state transition
 *
 * ── Usage ──────────────────────────────────────────────────────────────────
 *
 *   const gate = new HoldfastGate({ storageKey: 'delete_db' });
 *
 *   gate.on('grant', () => executeDestructiveAction());
 *   gate.on('breach', snap => showCooldown(snap.lockRemaining));
 *
 *   element.addEventListener('pointerdown', e => gate.hold(e.clientX, e.clientY));
 *   element.addEventListener('pointermove', e => gate.move(e.clientX, e.clientY));
 *   element.addEventListener('pointerup',   () => gate.release());
 *
 *   // In your animation loop (optional — for time-based events like expiry):
 *   function loop() { gate.tick(); requestAnimationFrame(loop); }
 */

// ─── Default configuration ────────────────────────────────────────────────

export const DEFAULTS = Object.freeze({
  // ── Stage 1: Sync hold
  syncMs          : 800,     // ms to hold steady to sync

  // ── Stage 2: Commit hold (adaptive)
  commitMs        : 1600,    // base commit hold time (ms)
  commitMsMin     : 1600,    // floor — never drops below this
  commitMsMax     : 6500,    // ceiling — never rises above this
  commitGrowMs    : 1000,    // +ms per successful grant
  commitGrowBonusMs: 600,    // bonus growth if re-granted quickly
  quickReformMs   : 9000,    // 'quick' threshold for bonus (ms)
  commitDecayMs   : 60000,   // ms idle before commitMs decays
  commitDecayStepMs: 400,    // decay amount per commitDecayMs window

  // ── Privilege window
  windowMs        : 15000,   // how long LIVE state lasts (ms)

  // ── Breach + cooldown
  lockMs          : 6000,    // first breach cooldown (ms)
  hardLockMs      : 20000,   // repeat breach cooldown (ms)

  // ── Pointer steadiness
  armMs           : 120,     // ms before jitter tracking arms
  steadyPx        : 6,       // max drift in pixels to be considered steady
  maxJitter       : 1.0,     // jitter score ceiling

  // ── Escalation + tension
  escalationCap   : 8,       // max breach count before escalation stops growing
  tensionStep1    : 0.35,    // tension increase on first breach
  tensionStep2    : 0.55,    // tension increase on repeat breach
  tensionRelease  : 0.70,    // tension decrease on successful grant
  escalationDecayMs: 60000,  // ms before escalation count drops

  // ── Persistence
  storageKey      : null,    // localStorage key (null = no persistence)

  // ── Internal
  clock           : () => performance.now(),
});

// ─── State constants (exported for consumer use) ──────────────────────────

export const State = Object.freeze({
  IDLE   : 'IDLE',
  PRIMED : 'PRIMED',
  LIVE   : 'LIVE',
  LOCKED : 'LOCKED',
});

// ─── Event constants ──────────────────────────────────────────────────────

export const Event = Object.freeze({
  SYNC         : 'sync',
  GRANT        : 'grant',
  BREACH       : 'breach',
  EXPIRED      : 'expired',
  LOCKED       : 'locked',
  CHANGE       : 'change',
});

// ─── HoldfastGate ─────────────────────────────────────────────────────────

export class HoldfastGate {

  /**
   * @param {Partial<typeof DEFAULTS>} opts
   */
  constructor(opts = {}) {
    this.cfg = { ...DEFAULTS, ...opts };

    // Clamp adaptive commit value coherently
    this.cfg.commitMs    = _clamp(this.cfg.commitMs,    this.cfg.commitMsMin, this.cfg.commitMsMax);
    this.cfg.commitMsMin = _clamp(this.cfg.commitMsMin, 100,                  this.cfg.commitMsMax);

    /** @private */
    this._listeners = {};
    /** @private — runtime adaptive commit value */
    this._commitAdaptive = this.cfg.commitMs;

    this.reset(true);

    if (this.cfg.storageKey) this._load();
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Begin a hold at pointer position (x, y).
   * Call on pointerdown.
   * @param {number} x
   * @param {number} y
   * @returns {object} decision
   */
  hold(x, y) {
    const t = this.cfg.clock();
    this._decayEscalation(t);
    this._decayCommit(t);

    if (t < this._lockUntil) {
      return this._decision('LOCKED', { t });
    }

    this._holding   = true;
    this._holdStart = t;
    this._armAt     = t + this.cfg.armMs;
    this._steady    = true;
    this._lastX     = x;
    this._lastY     = y;
    this._jitter    = 0;
    this._moves     = 0;

    return this._decision('ENGAGED', { t });
  }

  /**
   * Update pointer position during a hold.
   * Call on pointermove.
   * @param {number} x
   * @param {number} y
   * @returns {null}
   */
  move(x, y) {
    if (!this._holding) return null;
    const t = this.cfg.clock();

    if (t < this._armAt) {
      this._lastX = x; this._lastY = y;
      return null;
    }

    const d = Math.hypot(x - this._lastX, y - this._lastY);
    this._moves++;
    this._jitter += d;
    if (d > this.cfg.steadyPx) this._steady = false;
    this._lastX = x;
    this._lastY = y;
    return null;
  }

  /**
   * End a hold.
   * Call on pointerup / pointercancel.
   * @returns {object} decision
   */
  release() {
    const t = this.cfg.clock();
    if (!this._holding) return this._decision('NO_HOLD', { t });

    this._holding = false;
    this._decayEscalation(t);
    this._decayCommit(t);

    if (t < this._lockUntil) {
      return this._decision('LOCKED', { t });
    }

    const heldMs      = t - this._holdStart;
    const steady      = this._steady;
    const jitterAvg   = this._moves > 0 ? this._jitter / this._moves : 0;
    const jitterScore = Math.min(1, jitterAvg / (this.cfg.steadyPx * this.cfg.maxJitter));

    // ── Stage 1: Sync
    if (!this._synced) {
      if (heldMs >= this.cfg.syncMs && steady) {
        this._synced = true;
        this._state  = State.PRIMED;
        this._persist();
        const d = this._decision('SYNC_OK', { t, heldMs, steady, jitterScore });
        this._emit(Event.SYNC, d);
        this._emit(Event.CHANGE, d);
        return d;
      }
      this._persist();
      return this._decision('SYNC_FAIL', { t, heldMs, steady, jitterScore });
    }

    // ── Stage 2: Commit
    const required   = this._commitAdaptive;
    const granted    = heldMs >= required && steady;

    if (granted) {
      this._windowUntil = t + this.cfg.windowMs;
      this.tension      = Math.max(0, this.tension - this.cfg.tensionRelease);
      this.escalation   = 0;
      this._state       = State.LIVE;

      this._growCommit(t);
      this._persist();

      const d = this._decision('GRANT', { t, heldMs, steady, jitterScore, required });
      this._emit(Event.GRANT, d);
      this._emit(Event.CHANGE, d);
      return d;
    }

    // Breach
    this._applyBreach(t, jitterScore);
    this._persist();

    const d = this._decision('BREACH', { t, heldMs, steady, jitterScore, required });
    this._emit(Event.BREACH, d);
    this._emit(Event.LOCKED, d);
    this._emit(Event.CHANGE, d);
    return d;
  }

  /**
   * Drive time-based transitions (window expiry, state changes).
   * Call each animation frame, or on a suitable interval.
   * Returns a descriptor if a transition occurred, otherwise null.
   * @returns {object|null}
   */
  tick() {
    const t    = this.cfg.clock();
    const prev = this._deriveState(this._lastTickAt || t);
    const next = this._deriveState(t);
    this._lastTickAt = t;

    this._decayCommit(t);

    if (prev !== next) {
      if (prev === State.LIVE && next !== State.LIVE) {
        this._synced = false;
        this._state  = State.IDLE;
        this._persist();
        const d = { type: 'EXPIRED', t, from: prev, to: next, ...this.snapshot() };
        this._emit(Event.EXPIRED, d);
        this._emit(Event.CHANGE, d);
        return d;
      }
      const d = { type: 'STATE_CHANGED', t, from: prev, to: next, ...this.snapshot() };
      this._emit(Event.CHANGE, d);
      return d;
    }

    return null;
  }

  /**
   * Current gate state as a plain object — safe to pass to rendering layers.
   * @returns {GateSnapshot}
   */
  snapshot() {
    const t = this.cfg.clock();
    this._decayEscalation(t);
    this._decayCommit(t);

    return {
      t,
      state          : this._deriveState(t),
      synced         : this._synced,
      live           : t < this._windowUntil,
      lockRemaining  : Math.max(0, this._lockUntil  - t),
      windowRemaining: Math.max(0, this._windowUntil - t),
      escalation     : this.escalation,
      tension        : this.tension,
      commitMs       : this._commitAdaptive,
      syncMs         : this.cfg.syncMs,
    };
  }

  /**
   * Reset gate state.
   * @param {boolean} [hard=false]  true clears escalation and tension too
   */
  reset(hard = false) {
    this._state       = State.IDLE;
    this._synced      = false;
    this._windowUntil = 0;
    this._lockUntil   = 0;

    this.escalation   = hard ? 0 : (this.escalation  || 0);
    this.tension      = hard ? 0 : (this.tension      || 0);

    this._commitAdaptive = hard
      ? this.cfg.commitMs
      : (this._commitAdaptive || this.cfg.commitMs);

    this._lastGrantAt       = 0;
    this._lastCommitDecayAt = this.cfg.clock();

    this._holding   = false;
    this._holdStart = 0;
    this._armAt     = 0;
    this._steady    = true;
    this._lastX     = 0;
    this._lastY     = 0;
    this._jitter    = 0;
    this._moves     = 0;

    this._lastBreachAt = 0;
    this._lastTickAt   = 0;

    this._persist();
    return this.snapshot();
  }

  // ── Event emitter ────────────────────────────────────────────────────────

  /**
   * Subscribe to a gate event.
   * @param {string} event  — 'sync' | 'grant' | 'breach' | 'expired' | 'locked' | 'change'
   * @param {function} fn
   * @returns {this}
   */
  on(event, fn) {
    (this._listeners[event] ??= []).push(fn);
    return this;
  }

  /**
   * Remove a listener.
   * @param {string} event
   * @param {function} fn
   * @returns {this}
   */
  off(event, fn) {
    if (this._listeners[event]) {
      this._listeners[event] = this._listeners[event].filter(f => f !== fn);
    }
    return this;
  }

  /**
   * Subscribe to an event once.
   * @param {string} event
   * @param {function} fn
   * @returns {this}
   */
  once(event, fn) {
    const wrapper = (data) => { fn(data); this.off(event, wrapper); };
    return this.on(event, wrapper);
  }

  /**
   * Remove all listeners for an event, or all listeners if no event given.
   * @param {string} [event]
   * @returns {this}
   */
  removeAllListeners(event) {
    if (event) delete this._listeners[event];
    else this._listeners = {};
    return this;
  }

  // ── Internals ────────────────────────────────────────────────────────────

  /** @private */
  _deriveState(t) {
    if (t < this._lockUntil)   return State.LOCKED;
    if (t < this._windowUntil) return State.LIVE;
    return this._synced ? State.PRIMED : State.IDLE;
  }

  /** @private */
  _growCommit(t) {
    let grow = this.cfg.commitGrowMs;
    if (this._lastGrantAt > 0) {
      if (t - this._lastGrantAt <= this.cfg.quickReformMs) {
        grow += this.cfg.commitGrowBonusMs;
      }
    }
    this._commitAdaptive   = _clamp(
      this._commitAdaptive + grow,
      this.cfg.commitMsMin,
      this.cfg.commitMsMax
    );
    this._lastGrantAt       = t;
    this._lastCommitDecayAt = t;
  }

  /** @private */
  _decayCommit(t) {
    if (t < this._windowUntil) {
      this._lastCommitDecayAt = t;
      return;
    }
    const dt = t - (this._lastCommitDecayAt || t);
    if (dt < this.cfg.commitDecayMs) return;
    const steps = Math.floor(dt / this.cfg.commitDecayMs);
    if (steps <= 0) return;

    if (this._commitAdaptive > this.cfg.commitMsMin) {
      this._commitAdaptive = Math.max(
        this.cfg.commitMsMin,
        this._commitAdaptive - steps * this.cfg.commitDecayStepMs
      );
      this._lastCommitDecayAt = t;
      this._persist();
    } else {
      this._lastCommitDecayAt = t;
    }
  }

  /** @private */
  _applyBreach(t, jitterScore) {
    this.escalation = Math.min(this.cfg.escalationCap, this.escalation + 1);
    this._lastBreachAt = t;

    const base         = this.escalation === 1 ? this.cfg.lockMs : this.cfg.hardLockMs;
    const jitterExtra  = Math.round(base * 0.5 * _clamp01(jitterScore));
    this._lockUntil    = t + base + jitterExtra;

    const step    = this.escalation === 1 ? this.cfg.tensionStep1 : this.cfg.tensionStep2;
    this.tension  = _clamp01(this.tension + step);

    this._synced      = false;
    this._windowUntil = 0;
    this._state       = State.IDLE;
  }

  /** @private */
  _decayEscalation(t) {
    if (!this._lastBreachAt) return;
    const dt = t - this._lastBreachAt;
    if (dt >= this.cfg.escalationDecayMs && this.escalation > 0) {
      const steps = Math.floor(dt / this.cfg.escalationDecayMs);
      this.escalation = Math.max(0, this.escalation - steps);
      this._lastBreachAt = t;
      this._persist();
    }
  }

  /** @private */
  _emit(event, data) {
    const listeners = this._listeners[event];
    if (listeners) listeners.forEach(fn => { try { fn(data); } catch {} });
  }

  /** @private */
  _decision(type, extra = {}) {
    const snap = this.snapshot();
    return {
      type,
      ...extra,
      ...snap,
      action:
        type === 'GRANT'    ? 'ALLOW'    :
        type === 'BREACH'   ? 'PENALIZE' :
        type === 'SYNC_OK'  ? 'ADVANCE'  :
        type === 'LOCKED'   ? 'DENY'     :
        'NOOP',
    };
  }

  /** @private */
  _persist() {
    if (!this.cfg.storageKey) return;
    try {
      localStorage.setItem(this.cfg.storageKey, JSON.stringify({
        synced          : this._synced,
        windowUntil     : this._windowUntil,
        lockUntil       : this._lockUntil,
        escalation      : this.escalation,
        tension         : this.tension,
        lastBreachAt    : this._lastBreachAt,
        commitAdaptive  : this._commitAdaptive,
        lastGrantAt     : this._lastGrantAt,
        lastCommitDecayAt: this._lastCommitDecayAt,
      }));
    } catch {}
  }

  /** @private */
  _load() {
    try {
      const raw = localStorage.getItem(this.cfg.storageKey);
      if (!raw) return;
      const p = JSON.parse(raw);

      this._synced           = !!p.synced;
      this._windowUntil      = +p.windowUntil      || 0;
      this._lockUntil        = +p.lockUntil        || 0;
      this.escalation        = +p.escalation       || 0;
      this.tension           = +p.tension          || 0;
      this._lastBreachAt     = +p.lastBreachAt     || 0;
      this._commitAdaptive   = _clamp(
        +p.commitAdaptive || this.cfg.commitMs,
        this.cfg.commitMsMin, this.cfg.commitMsMax
      );
      this._lastGrantAt       = +p.lastGrantAt       || 0;
      this._lastCommitDecayAt = +p.lastCommitDecayAt || this.cfg.clock();

      this._state = this._deriveState(this.cfg.clock());
    } catch {}
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────

function _clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function _clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }

/**
 * @typedef {object} GateSnapshot
 * @property {number}  t                — current time (ms, from clock)
 * @property {string}  state            — 'IDLE' | 'PRIMED' | 'LIVE' | 'LOCKED'
 * @property {boolean} synced           — sync hold passed
 * @property {boolean} live             — currently in privilege window
 * @property {number}  lockRemaining    — ms left in cooldown (0 if not locked)
 * @property {number}  windowRemaining  — ms left in privilege window
 * @property {number}  escalation       — breach count (0–escalationCap)
 * @property {number}  tension          — compound breach score 0–1
 * @property {number}  commitMs         — current adaptive commit duration (ms)
 * @property {number}  syncMs           — required sync hold duration (ms)
 */
