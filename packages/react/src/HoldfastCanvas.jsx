/**
 * HoldfastCanvas — the hold mechanic rendered in Canvas2D.
 *
 * Draws:
 *   • A contracting outer ring as charge builds
 *   • A clockface progress arc sweeping 0→360°
 *   • A bright tip dot at the arc's leading edge
 *   • A central glow that surges on GRANT
 *   • A brief full-canvas flash on GRANT
 *
 * Phase colours
 *   Sync phase  →  cool blue  (#50B4FF)
 *   Commit phase → amber/gold (#FFCA3A)
 *   LIVE state   → warm white pulse
 *   LOCKED state → orange warning (#F07828)
 *
 * All rendering is pure Canvas2D — zero DOM mutation inside the canvas,
 * no external assets, no dependencies beyond React.
 */

import { useEffect, useRef, useCallback } from 'react';
import { State } from '@holdfastjs/core';

const TAU = Math.PI * 2;

const PHASE_COLORS = {
  sync  : [80,  180, 255],
  commit: [255, 202,  58],
  live  : [255, 255, 200],
  locked: [240, 120,  40],
  idle  : [120, 130, 160],
};

function lerp(a, b, t) { return a + (b - a) * Math.min(1, Math.max(0, t)); }
function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
function ease(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t) * t; }

/**
 * @param {{
 *   snapshot: import('@holdfastjs/core').GateSnapshot,
 *   isHolding: boolean,
 *   holdStartMs: number,
 *   size?: number,
 *   accentColor?: string,
 * }} props
 */
export function HoldfastCanvas({ snapshot, isHolding, holdStartMs, size = 140, accentColor }) {
  const canvasRef   = useRef(null);
  const flashRef    = useRef(0);     // 0–1, decays
  const prevLiveRef = useRef(false);
  const rafRef      = useRef(null);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const S   = size;

    if (canvas.width !== Math.round(S * dpr)) {
      canvas.width  = Math.round(S * dpr);
      canvas.height = Math.round(S * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, S, S);

    const cx   = S / 2;
    const cy   = S / 2;
    const snap = snapshot;
    if (!snap) return;

    const now    = performance.now();
    const sec    = now / 1000;
    const { state, synced, live, escalation, tension, commitMs, syncMs } = snap;

    // ── Derive hold progress
    const holdMs    = isHolding ? (now - holdStartMs) : 0;
    const inPhase   = isHolding && state !== 'LOCKED' && !live;
    const phase     = inPhase ? (synced ? 'commit' : 'sync')  : null;
    const reqMs     = synced ? commitMs : syncMs;
    const chargeP   = phase ? clamp(holdMs / reqMs, 0, 1) : 0;

    // ── Flash on LIVE state entry
    if (live && !prevLiveRef.current) flashRef.current = 1.0;
    prevLiveRef.current = live;
    if (flashRef.current > 0) flashRef.current = Math.max(0, flashRef.current - 0.04);

    // ── Pick colors
    const stateColor =
      state === State.LIVE   ? PHASE_COLORS.live   :
      state === State.LOCKED ? PHASE_COLORS.locked :
      phase === 'commit'     ? PHASE_COLORS.commit :
      phase === 'sync'       ? PHASE_COLORS.sync   :
      PHASE_COLORS.idle;

    const [cR, cG, cB] = accentColor ? hexToRgb(accentColor) : stateColor;

    const fl = flashRef.current;

    // ── 1. GRANT flash (full canvas radial bloom)
    if (fl > 0.01) {
      const gr = ctx.createRadialGradient(cx, cy, 0, cx, cy, S * 0.72);
      gr.addColorStop(0,   `rgba(255,245,200,${fl * 0.70})`);
      gr.addColorStop(0.5, `rgba(${cR},${cG},${cB},${fl * 0.22})`);
      gr.addColorStop(1,   `rgba(0,0,0,0)`);
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      ctx.fillStyle = gr;
      ctx.fillRect(0, 0, S, S);
      ctx.restore();
    }

    // ── 2. Contracting outer ring during hold
    if (chargeP > 0.02) {
      const ringR = lerp(S * 0.46, S * 0.22, ease(chargeP));
      ctx.save();
      ctx.globalCompositeOperation = 'screen';
      // outer glow
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${chargeP * 0.25})`;
      ctx.lineWidth   = 4 + chargeP * 3;
      ctx.stroke();
      // crisp line
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, TAU);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${chargeP * 0.60})`;
      ctx.lineWidth   = 1.0;
      ctx.stroke();
      ctx.restore();
    }

    // ── 3. Arc track ring (base)
    const arcR = S * 0.34;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, arcR, 0, TAU);
    ctx.strokeStyle = `rgba(${cR},${cG},${cB},${live ? 0.18 : 0.08})`;
    ctx.lineWidth   = 1.2;
    ctx.stroke();
    ctx.restore();

    // ── 4. Progress arc (sweeping clockwise from top)
    if (chargeP > 0.005 || live) {
      const sweep = live ? TAU : chargeP * TAU;
      const start = -Math.PI / 2;
      const end   = start + sweep;

      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalCompositeOperation = 'screen';

      // Glow layer
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, start, end);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${(live ? 0.35 : chargeP * 0.22) + fl * 0.2})`;
      ctx.lineWidth   = 10;
      ctx.stroke();

      // Sharp line
      ctx.beginPath();
      ctx.arc(cx, cy, arcR, start, end);
      ctx.strokeStyle = `rgba(${cR},${cG},${cB},${live ? 0.90 : 0.55 + chargeP * 0.40})`;
      ctx.lineWidth   = 1.8;
      ctx.stroke();

      // Tip dot
      if (!live) {
        const tx = cx + Math.cos(end) * arcR;
        const ty = cy + Math.sin(end) * arcR;
        ctx.beginPath();
        ctx.arc(tx, ty, 3.0 + chargeP * 1.5, 0, TAU);
        ctx.fillStyle = `rgba(${cR},${cG},${cB},${0.65 + chargeP * 0.35})`;
        ctx.fill();
      }

      // Quarter-marks
      for (const f of [0.25, 0.5, 0.75]) {
        if (chargeP < f) break;
        const ma = start + f * TAU;
        ctx.beginPath();
        ctx.arc(cx + Math.cos(ma) * arcR, cy + Math.sin(ma) * arcR, 2.0, 0, TAU);
        ctx.fillStyle = `rgba(${cR},${cG},${cB},0.85)`;
        ctx.fill();
      }

      ctx.restore();
    }

    // ── 5. Central glow
    {
      const pulse  = live
        ? (0.80 + 0.20 * Math.sin(sec * 2.2))
        : (0.60 + 0.40 * Math.sin(sec * 0.9));
      const glowA  = live ? (0.55 + fl * 0.35) * pulse : (chargeP * 0.40 + fl * 0.30) * pulse;
      const glowR  = S * (live ? 0.18 : 0.12 + chargeP * 0.06) * pulse;

      if (glowA > 0.02) {
        const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
        glow.addColorStop(0, `rgba(${cR},${cG},${cB},${glowA})`);
        glow.addColorStop(1, `rgba(${cR},${cG},${cB},0)`);
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(cx, cy, glowR, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      // Core dot
      const dotA = live ? (0.90 + fl * 0.10) : (0.35 + chargeP * 0.55);
      ctx.beginPath();
      ctx.arc(cx, cy, live ? 4.0 : 2.0 + chargeP * 2.0, 0, TAU);
      ctx.fillStyle = `rgba(${cR},${cG},${cB},${dotA})`;
      ctx.fill();
    }

    // ── 6. Tension indicator (arc outside the progress arc when tension > 0)
    if (tension > 0.05 && state === State.LOCKED) {
      const tensionR = S * 0.44;
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, tensionR, 0, tension * TAU);
      ctx.strokeStyle = `rgba(240,120,40,${0.40 * tension})`;
      ctx.lineWidth   = 2.5;
      ctx.stroke();
      ctx.restore();
    }

    rafRef.current = requestAnimationFrame(draw);
  }, [snapshot, isHolding, holdStartMs, size, accentColor]);

  useEffect(() => {
    rafRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafRef.current);
  }, [draw]);

  return (
    <canvas
      ref={canvasRef}
      width={Math.round(size * 2)}
      height={Math.round(size * 2)}
      style={{ width: size, height: size, display: 'block' }}
      aria-hidden="true"
    />
  );
}

// ── Helpers

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}
