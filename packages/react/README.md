# @holdgate/react

**React component + hook for HoldfastGate.**

```bash
npm install @holdgate/core @holdgate/react
```

## `<HoldfastGuard>` — drop-in overlay

Wraps any trigger element. On click, renders a full-screen confirmation
overlay with Canvas2D hold feedback. Handles pointer capture, keyboard
(Enter/Space to hold, Escape to cancel), and accessibility.

```jsx
import { HoldfastGuard } from '@holdgate/react';

<HoldfastGuard
  label="Drop table users_prod"
  severity="critical"
  onConfirm={() => dropTable()}
>
  <button>Drop Table</button>
</HoldfastGuard>
```

## `useHoldfast` — bring your own UI

```jsx
import { useHoldfast } from '@holdgate/react';

function MyConfirmButton() {
  const { snapshot, handlers, gate } = useHoldfast({
    commitMs  : 2200,
    storageKey: 'my_action',
  });

  gate.on('grant', () => executeAction());

  return (
    <div
      {...handlers}
      style={{ background: snapshot.live ? 'gold' : 'transparent' }}
    >
      {snapshot.state === 'LIVE'   && 'Authorised'}
      {snapshot.state === 'PRIMED' && 'Hold to confirm'}
      {snapshot.state === 'IDLE'   && 'Hold to sync'}
      {snapshot.state === 'LOCKED' && `Locked ${Math.ceil(snapshot.lockRemaining/1000)}s`}
    </div>
  );
}
```

## `<HoldfastCanvas>` — visual only

Renders just the hold mechanic canvas. Use when you want the visual but
manage gate state yourself.

```jsx
import { HoldfastCanvas } from '@holdgate/react';

<HoldfastCanvas
  snapshot={snapshot}
  isHolding={isHolding}
  holdStartMs={holdStart}
  size={140}
  accentColor="#FFCA3A"
/>
```

See root [README](../../README.md) for full prop reference.
