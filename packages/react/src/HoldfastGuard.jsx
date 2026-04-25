/**
 * HoldfastGuard — drop-in confirmation wrapper for destructive actions.
 *
 * Wraps any element. When activated, renders a full-screen overlay
 * requiring a sustained, steady hold to confirm. Short taps incur a
 * cooldown. Repeated impulsive taps escalate the penalty.
 *
 * @example — minimal
 * <HoldfastGuard label="Drop table users_prod" onConfirm={dropTable}>
 *   <button>Drop Table</button>
 * </HoldfastGuard>
 *
 * @example — configured
 * <HoldfastGuard
 *   label="Force-push to main"
 *   severity="critical"
 *   commitMs={3500}
 *   storageKey="force_push_main"
 *   onConfirm={forcePush}
 *   onCancel={() => setOpen(false)}
 *   theme="dark"
 * >
 *   <Button variant="danger">Force Push</Button>
 * </HoldfastGuard>
 *
 * Severity presets
 *   'caution'  — syncMs:600 commitMs:1200  lockMs:4000
 *   'danger'   — syncMs:800 commitMs:2200  lockMs:8000   (default)
 *   'critical' — syncMs:800 commitMs:3500  lockMs:20000  adaptive:true
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { HoldfastGate, State } from '@holdfastjs/core';
import { HoldfastCanvas } from './HoldfastCanvas.jsx';

// ── Severity presets

const SEVERITY = {
  caution: {
    syncMs     : 600,
    commitMs   : 1200,
    lockMs     : 4000,
    hardLockMs : 12000,
    windowMs   : 12000,
    commitMsMax: 4000,
  },
  danger: {
    syncMs     : 800,
    commitMs   : 2200,
    lockMs     : 8000,
    hardLockMs : 20000,
    windowMs   : 15000,
    commitMsMax: 6500,
  },
  critical: {
    syncMs     : 800,
    commitMs   : 3500,
    lockMs     : 20000,
    hardLockMs : 40000,
    windowMs   : 15000,
    commitMsMax: 9000,
    commitGrowMs: 1200,
  },
};

// ── Styles (inline — no CSS file dependency)

const STYLES = {
  overlay: {
    position       : 'fixed',
    inset          : 0,
    zIndex         : 9999,
    display        : 'flex',
    alignItems     : 'center',
    justifyContent : 'center',
    flexDirection  : 'column',
    gap            : '0',
    background     : 'rgba(4,6,10,0.88)',
    backdropFilter : 'blur(6px)',
    WebkitBackdropFilter: 'blur(6px)',
    userSelect     : 'none',
    WebkitUserSelect: 'none',
    touchAction    : 'none',
    cursor         : 'pointer',
  },
  card: {
    display        : 'flex',
    flexDirection  : 'column',
    alignItems     : 'center',
    gap            : '18px',
    padding        : '36px 40px',
    background     : 'rgba(10,14,22,0.92)',
    border         : '1px solid rgba(255,255,255,0.08)',
    borderRadius   : '12px',
    maxWidth       : '380px',
    width          : '90vw',
    boxShadow      : '0 24px 80px rgba(0,0,0,0.6)',
  },
  label: {
    fontFamily     : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize       : '13px',
    lineHeight     : '1.5',
    color          : 'rgba(220,230,250,0.80)',
    textAlign      : 'center',
    maxWidth       : '280px',
    wordBreak      : 'break-word',
  },
  hint: {
    fontFamily     : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize       : '11px',
    color          : 'rgba(180,190,220,0.45)',
    textAlign      : 'center',
    letterSpacing  : '0.04em',
    minHeight      : '18px',
    transition     : 'color 0.2s',
  },
  hintWarning: {
    color          : 'rgba(240,160,60,0.80)',
  },
  cancel: {
    marginTop      : '8px',
    background     : 'none',
    border         : 'none',
    color          : 'rgba(180,190,220,0.30)',
    fontFamily     : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize       : '11px',
    cursor         : 'pointer',
    padding        : '6px 12px',
    borderRadius   : '4px',
    letterSpacing  : '0.04em',
    transition     : 'color 0.15s',
  },
};

// ── Component

export function HoldfastGuard({
  children,
  label         = 'Confirm action',
  severity      = 'danger',
  onConfirm,
  onCancel,
  theme         = 'dark',
  accentColor,

  // Direct config overrides (take precedence over severity preset)
  syncMs,
  commitMs,
  windowMs,
  lockMs,
  hardLockMs,
  storageKey,
  adaptive      = false,
}) {
  const [open, setOpen]         = useState(false);
  const [snapshot, setSnapshot] = useState(null);
  const [isHolding, setHolding] = useState(false);
  const [holdStart, setHoldStart] = useState(0);
  const [hintText, setHint]     = useState('');
  const [hintWarn, setHintWarn] = useState(false);

  const gateRef = useRef(null);
  const rafRef  = useRef(null);
  const confirmedRef = useRef(false);

  // Build gate config from severity + overrides
  const preset = SEVERITY[severity] ?? SEVERITY.danger;
  const gateOpts = {
    ...preset,
    ...(syncMs       !== undefined && { syncMs }),
    ...(commitMs     !== undefined && { commitMs }),
    ...(windowMs     !== undefined && { windowMs }),
    ...(lockMs       !== undefined && { lockMs }),
    ...(hardLockMs   !== undefined && { hardLockMs }),
    ...(storageKey   !== undefined && { storageKey }),
    ...(!adaptive && { commitGrowMs: 0, commitGrowBonusMs: 0 }),
  };

  function openGuard() {
    confirmedRef.current = false;
    const gate = new HoldfastGate(gateOpts);

    gate.on('grant', (snap) => {
      confirmedRef.current = true;
      setSnapshot(snap);
      // Brief LIVE flash, then confirm and close
      setTimeout(() => {
        setOpen(false);
        setHolding(false);
        onConfirm?.();
      }, 600);
    });

    gate.on('breach', (snap) => {
      setSnapshot(snap);
      const secs = Math.ceil(snap.lockRemaining / 1000);
      setHint(`Locked — ${secs}s`);
      setHintWarn(true);
    });

    gate.on('sync', (snap) => {
      setSnapshot(snap);
      setHint('Synced — hold to confirm');
      setHintWarn(false);
    });

    gateRef.current = gate;
    setSnapshot(gate.snapshot());
    setHint('Hold to sync');
    setHintWarn(false);
    setOpen(true);
  }

  function closeGuard() {
    cancelAnimationFrame(rafRef.current);
    gateRef.current?.removeAllListeners();
    gateRef.current = null;
    setOpen(false);
    setHolding(false);
    onCancel?.();
  }

  // Tick loop while open
  useEffect(() => {
    if (!open || !gateRef.current) return;

    const loop = () => {
      if (!gateRef.current) return;
      const ev = gateRef.current.tick();
      const snap = gateRef.current.snapshot();
      setSnapshot(snap);

      if (snap.state === State.LOCKED) {
        const secs = Math.ceil(snap.lockRemaining / 1000);
        setHint(`Locked — ${secs}s`);
        setHintWarn(true);
      } else if (snap.state === State.LIVE && !confirmedRef.current) {
        setHint('Authorised');
        setHintWarn(false);
      } else if (snap.state === State.PRIMED && !isHolding) {
        setHint('Hold to confirm');
        setHintWarn(false);
      } else if (snap.state === State.IDLE && !isHolding) {
        setHint('Hold to sync');
        setHintWarn(false);
      }

      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [open, isHolding]);

  // Escape key
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeGuard();
      if ((e.key === 'Enter' || e.key === ' ') && gateRef.current) {
        // Keyboard hold: treat as pointer at centre of overlay
        gateRef.current.hold(window.innerWidth / 2, window.innerHeight / 2);
        setHolding(true);
        setHoldStart(performance.now());
      }
    };
    const onKeyUp = (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && gateRef.current) {
        gateRef.current.release();
        setHolding(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup',   onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup',   onKeyUp);
    };
  }, [open]);

  const onPointerDown = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    if (!gateRef.current) return;
    const d = gateRef.current.hold(e.clientX, e.clientY);
    setHolding(true);
    setHoldStart(performance.now());
    if (d?.state === State.LOCKED) {
      const secs = Math.ceil(d.lockRemaining / 1000);
      setHint(`Locked — ${secs}s`);
      setHintWarn(true);
    }
  }, []);

  const onPointerMove = useCallback((e) => {
    gateRef.current?.move(e.clientX, e.clientY);
  }, []);

  const onPointerUp = useCallback(() => {
    if (!gateRef.current) return;
    gateRef.current.release();
    setHolding(false);
  }, []);

  // Clone child to inject the open trigger
  const trigger = (() => {
    if (!children) return null;
    const child = Array.isArray(children) ? children[0] : children;
    if (!child) return null;
    return {
      ...child,
      props: {
        ...child.props,
        onClick: (e) => {
          child.props?.onClick?.(e);
          openGuard();
        },
      },
    };
  })();

  const stateLabel =
    snapshot?.state === State.LIVE   ? 'AUTHORISED' :
    snapshot?.state === State.LOCKED ? 'LOCKED'     :
    snapshot?.state === State.PRIMED ? 'SYNCED'     :
    'HOLD';

  const accent =
    accentColor ??
    (snapshot?.state === State.LIVE   ? '#FFCA3A' :
     snapshot?.state === State.LOCKED ? '#F07828' :
     snapshot?.synced                 ? '#FFCA3A' :
     '#50B4FF');

  return (
    <>
      {trigger}

      {open && (
        <div
          style={STYLES.overlay}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          role="alertdialog"
          aria-modal="true"
          aria-label={`Confirm: ${label}`}
        >
          <div style={STYLES.card} onClick={(e) => e.stopPropagation()}>
            <div style={{
              fontFamily   : 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
              fontSize     : '10px',
              letterSpacing: '0.12em',
              color        : accent,
              opacity      : 0.70,
            }}>
              {stateLabel}
            </div>

            <HoldfastCanvas
              snapshot={snapshot}
              isHolding={isHolding}
              holdStartMs={holdStart}
              size={140}
              accentColor={accent}
            />

            <div style={STYLES.label}>{label}</div>

            <div style={{ ...STYLES.hint, ...(hintWarn ? STYLES.hintWarning : {}) }}>
              {hintText}
            </div>
          </div>

          <button
            style={STYLES.cancel}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); closeGuard(); }}
            onMouseEnter={(e) => { e.target.style.color = 'rgba(180,190,220,0.65)'; }}
            onMouseLeave={(e) => { e.target.style.color = 'rgba(180,190,220,0.30)'; }}
          >
            ESC to cancel
          </button>
        </div>
      )}
    </>
  );
}
