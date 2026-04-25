/**
 * useHoldfast — React hook for HoldfastGate
 *
 * Manages a gate instance, drives tick() via rAF, and exposes current
 * snapshot + pointer event handlers. Wire the handlers to any element.
 *
 * @example
 * const { snapshot, handlers, gate } = useHoldfast({ commitMs: 2200 });
 *
 * gate.on('grant', () => executeAction());
 *
 * return (
 *   <div {...handlers}>
 *     {snapshot.state === 'LIVE' ? 'Authorised' : 'Hold to confirm'}
 *   </div>
 * );
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { HoldfastGate } from '@holdgate/core';

/**
 * @param {import('@holdgate/core').DEFAULTS} [opts]
 * @returns {{ snapshot: import('@holdgate/core').GateSnapshot, handlers: object, gate: HoldfastGate }}
 */
export function useHoldfast(opts = {}) {
  const gateRef    = useRef(null);
  const rafRef     = useRef(null);
  const optsRef    = useRef(opts);
  optsRef.current  = opts;

  const [snapshot, setSnapshot] = useState(null);

  // Create gate once
  if (!gateRef.current) {
    gateRef.current = new HoldfastGate(opts);
  }

  useEffect(() => {
    const gate = gateRef.current;

    // Seed initial snapshot
    setSnapshot(gate.snapshot());

    // Drive tick + re-render on state change
    const loop = () => {
      const ev = gate.tick();
      if (ev) setSnapshot(gate.snapshot());
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);

    // Reflect state changes triggered by hold/release
    const onAny = () => setSnapshot(gate.snapshot());
    gate.on('sync',    onAny);
    gate.on('grant',   onAny);
    gate.on('breach',  onAny);
    gate.on('expired', onAny);
    gate.on('locked',  onAny);

    return () => {
      cancelAnimationFrame(rafRef.current);
      gate.removeAllListeners();
    };
  }, []); // gate instance is stable

  const hold = useCallback((e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    const d = gateRef.current.hold(e.clientX, e.clientY);
    if (d) setSnapshot(gateRef.current.snapshot());
  }, []);

  const move = useCallback((e) => {
    gateRef.current.move(e.clientX, e.clientY);
  }, []);

  const release = useCallback(() => {
    const d = gateRef.current.release();
    if (d) setSnapshot(gateRef.current.snapshot());
  }, []);

  const handlers = {
    onPointerDown  : hold,
    onPointerMove  : move,
    onPointerUp    : release,
    onPointerCancel: release,
  };

  return {
    snapshot: snapshot ?? gateRef.current.snapshot(),
    handlers,
    gate: gateRef.current,
  };
}
