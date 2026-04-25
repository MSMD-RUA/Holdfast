# Holdfast

**A behavioural confirmation engine. Gates privileged actions behind sustained, steady intent.**

Not password-based. Not token-based. **State-based** — are you composed enough, right now, to act?

---

## The pūrākau

Rātā went to fell a tree for his canoe. He cut it down. The next morning, it stood again. He cut it again. It rose again.

He hid and watched. The hākuturi — forest spirits — chanted: *"Fly together, chips and shavings. Stand upright again, O tree."*

They said: *"You cannot fell the tree without protocol. First, prove you are present. Then prove your intent. Then we will give you the canoe."*

Holdfast is that gate. For UI.

**MIT licensed. Free forever. Because the gift is the canoe. The journey is yours.**

---

## The problem

Every destructive action in software ends the same way: a dialog box with an OK button.

You can click it accidentally. You can click it panicking. You can paste "DELETE" into a text field without reading it. The confirmation exists, but it confirms nothing about your state of mind at the moment of consequence.

Holdfast solves this by requiring **physical steadiness** instead of a button click. A user who is calm and deliberate can hold a pointer still for two seconds. A user who is panicked, distracted, or acting impulsively cannot — and if they try too fast, they're locked out.

---

## How it works

### State machine
IDLE → (sync hold) → PRIMED → (commit hold) → LIVE → (expiry) → IDLE
↓ breach
LOCKED → IDLE

text

**IDLE** — Nothing has happened. Default state.

**PRIMED** — Sync hold passed (default 800ms, steady pointer). User is present and engaged.

**LIVE** — Commit hold passed (default 1.6–6.5s, adaptive). Privilege window open. Execute your action here.

**LOCKED** — Breach penalty active. Cooldown running (6s–20s+). Too fast, too impulsive.

### Two-stage design

**Stage 1 — Sync** (800ms by default):
Short hold to prove presence. Fail is silent — no penalty, just try again. This separates accidental touches from deliberate engagement.

**Stage 2 — Commit** (1.6s+ adaptive):
Longer hold to earn the privilege window. Fail → breach penalty + lockout. Pass → LIVE.

### Adaptive commit duration

Every successful commit makes the next one harder:

- +1000ms per grant (base)
- +600ms bonus if re-granted within 9 seconds
- Ceiling: 6500ms
- Decays back to base over 60 seconds of inactivity

Prevents farming (hold minimum, wait, repeat). Frequent use means deeper commitment required.

### Breach and tension

A breach is an impulsive release during the commit phase. The action is not blocked — the **cost** is what follows:

- First breach: 6s cooldown
- Repeat breaches: 20s cooldown
- Jitter penalty: up to +50% if the pointer was unstable
- Tension: compound score 0–1, available for UI warning escalation
- Escalation count decays after 60s of clean behaviour

---

## Packages

| Package | Description |
|---|---|
| [`@holdfastjs/core`](packages/core) | Pure JS engine. Zero dependencies. Works anywhere. |
| [`@holdfastjs/react`](packages/react) | React component + hook. Drop-in overlay. |
| [`@holdfastjs/element`](packages/element) | Web Component. Framework-agnostic. |

---

## Quick start

### Core (framework-agnostic)

```bash
npm install @holdfastjs/core
js
import { HoldfastGate } from '@holdfastjs/core';

const gate = new HoldfastGate({ storageKey: 'delete_db' });

gate.on('grant',  ()    => executeDestructiveAction());
gate.on('breach', snap  => showWarning(snap.lockRemaining));
gate.on('sync',   ()    => setHint('Synced — hold to confirm'));
gate.on('locked', snap  => showCooldown(snap.lockRemaining));

element.addEventListener('pointerdown', e => gate.hold(e.clientX, e.clientY));
element.addEventListener('pointermove', e => gate.move(e.clientX, e.clientY));
element.addEventListener('pointerup',   () => gate.release());

// Drive expiry checks (any animation loop or interval):
function loop() { gate.tick(); requestAnimationFrame(loop); }
React
bash
npm install @holdfastjs/core @holdfastjs/react
jsx
import { HoldfastGuard } from '@holdfastjs/react';

function DeleteButton() {
  return (
    <HoldfastGuard
      label="Drop table users_prod"
      severity="critical"
      onConfirm={() => dropTable()}
    >
      <button>Drop Table</button>
    </HoldfastGuard>
  );
}
That's it. The guard handles the overlay, canvas animation, pointer capture, keyboard support, accessibility, and state feedback.

Web Component
bash
npm install @holdfastjs/core @holdfastjs/element
html
<script type="module">
  import '@holdfastjs/element';
</script>

<holdfast-gate label="Delete account" severity="danger">
  <button>Delete Account</button>
</holdfast-gate>

<script>
  document.querySelector('holdfast-gate')
    .addEventListener('hf:grant', () => deleteAccount());
</script>
API — Core
new HoldfastGate(options)
Option	Type	Default	Description
syncMs	number	800	Sync hold duration (ms)
commitMs	number	1600	Base commit hold duration (ms)
commitMsMin	number	1600	Adaptive floor
commitMsMax	number	6500	Adaptive ceiling
commitGrowMs	number	1000	ms added per grant
commitGrowBonusMs	number	600	Bonus ms if re-granted quickly
quickReformMs	number	9000	Window for "quick" bonus (ms)
commitDecayMs	number	60000	ms before commit decays
commitDecayStepMs	number	400	Decay amount per window
windowMs	number	15000	Privilege window duration (ms)
lockMs	number	6000	First breach cooldown (ms)
hardLockMs	number	20000	Repeat breach cooldown (ms)
steadyPx	number	6	Max drift in pixels to be "steady"
escalationCap	number	8	Max escalation count
storageKey	string	null	localStorage key for persistence
Methods
js
gate.hold(x, y)      // Begin hold at pointer position
gate.move(x, y)      // Update pointer during hold
gate.release()       // End hold
gate.tick()          // Drive time-based transitions (call each frame)
gate.snapshot()      // Current state snapshot
gate.reset(hard?)    // Reset state (hard=true clears escalation/tension)

gate.on(event, fn)   // Subscribe to gate event
gate.off(event, fn)  // Unsubscribe
gate.once(event, fn) // Subscribe once
gate.removeAllListeners(event?)
Events
js
gate.on('sync',    snap => {})  // Sync hold passed → PRIMED
gate.on('grant',   snap => {})  // Commit hold passed → LIVE
gate.on('breach',  snap => {})  // Impulsive release, penalty applied
gate.on('expired', snap => {})  // LIVE window ended → IDLE
gate.on('locked',  snap => {})  // Cooldown started
gate.on('change',  snap => {})  // Any state transition
Snapshot
ts
{
  t              : number   // current time (ms)
  state          : 'IDLE' | 'PRIMED' | 'LIVE' | 'LOCKED'
  synced         : boolean  // sync stage passed
  live           : boolean  // currently in privilege window
  lockRemaining  : number   // ms left in cooldown
  windowRemaining: number   // ms left in privilege window
  escalation     : number   // breach count 0–escalationCap
  tension        : number   // compound breach score 0–1
  commitMs       : number   // current adaptive commit duration
  syncMs         : number   // sync hold duration
}
@holdfastjs/react — HoldfastGuard props
tsx
<HoldfastGuard
  label="Action description"    // required — shown in overlay
  severity="danger"             // 'caution' | 'danger' | 'critical'
  onConfirm={fn}                // called when LIVE is reached
  onCancel={fn}                 // called on cancel

  // Config overrides (optional)
  syncMs={800}
  commitMs={2200}
  windowMs={15000}
  storageKey="my_action"
  adaptive={false}              // enable adaptive commit growth
  accentColor="#4BADE8"
>
  <YourButton />
</HoldfastGuard>
Severity presets:

Severity	syncMs	commitMs	lockMs
caution	600ms	1.2s	4s
danger	800ms	2.2s	8s
critical	800ms	3.5s	20s
useHoldfast hook
js
const { snapshot, handlers, gate } = useHoldfast({
  commitMs  : 2200,
  storageKey: 'my_action',
});

gate.on('grant', () => executeAction());

return <div {...handlers}>...</div>;
@holdfastjs/element — Web Component events
Event	Detail	When
hf:grant	GateSnapshot	Permission earned
hf:breach	GateSnapshot	Breach penalty applied
hf:sync	GateSnapshot	Sync achieved
hf:locked	GateSnapshot	Cooldown started
hf:expired	GateSnapshot	LIVE window ended
hf:cancel	null	User cancelled overlay
Use cases
Developer tooling — Destructive database operations, force-push, infrastructure teardown.

Financial — Large transfers, account closure, subscription cancellation.

Impulsive behaviour friction — Social media post confirmation, spend controls.

Medical / industrial — Any interface where physiological state at time of action matters.

Access lifecycle — Short-lived privilege windows (windowMs) that require re-earning instead of staying permanently elevated.

Development
bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Watch mode
pnpm dev

# Publish (after changeset)
pnpm release
License
MIT

Built by the same hand as AgenticRail
Holdfast is the UI layer of sequence enforcement. Need the same guarantee at the API layer? AgenticRail enforces deterministic order for AI agents — no replays, no skips, sealed completions, cryptographic receipts.

→ agenticrail.nz

Sequence is law.



