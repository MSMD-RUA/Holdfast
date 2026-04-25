# @holdfastjs/core

**The HoldfastGate engine. Pure JS, zero dependencies, ~5KB.**

Gates privileged actions behind sustained, steady intent. Works in any
JavaScript environment — browser, Node, React, Vue, Svelte, vanilla.

```bash
npm install @holdfastjs/core
```

## Minimal usage

```js
import { HoldfastGate } from '@holdfastjs/core';

const gate = new HoldfastGate({ storageKey: 'confirm_delete' });

gate.on('grant',  ()   => deleteRecord());
gate.on('breach', snap => showCooldown(snap.lockRemaining));

canvas.addEventListener('pointerdown', e => gate.hold(e.clientX, e.clientY));
canvas.addEventListener('pointermove', e => gate.move(e.clientX, e.clientY));
canvas.addEventListener('pointerup',   () => gate.release());
```

## State machine

```
IDLE → sync hold → PRIMED → commit hold → LIVE → expiry → IDLE
                                 ↓ breach
                               LOCKED
```

| State | Description |
|---|---|
| `IDLE` | No engagement. Default. |
| `PRIMED` | Sync hold passed. Ready to commit. |
| `LIVE` | Privilege window open. Execute action. |
| `LOCKED` | Breach penalty. Cooldown running. |

## States and Events exports

```js
import { HoldfastGate, State, Event, DEFAULTS } from '@holdfastjs/core';

// State constants
State.IDLE    // 'IDLE'
State.PRIMED  // 'PRIMED'
State.LIVE    // 'LIVE'
State.LOCKED  // 'LOCKED'

// Event name constants
Event.SYNC     // 'sync'
Event.GRANT    // 'grant'
Event.BREACH   // 'breach'
Event.EXPIRED  // 'expired'
Event.LOCKED   // 'locked'
Event.CHANGE   // 'change'
```

## Full API

See root [README](../../README.md) for complete option reference, snapshot schema, and examples.
