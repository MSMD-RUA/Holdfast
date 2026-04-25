# @holdfastjs/element

**Web Component for HoldfastGate. Framework-agnostic.**

```bash
npm install @holdfastjs/core @holdfastjs/element
```

## Usage

```html
<script type="module">
  import '@holdfastjs/element';
</script>

<holdfast-gate label="Drop table users_prod" severity="critical">
  <button>Drop Table</button>
</holdfast-gate>

<script>
  document.querySelector('holdfast-gate')
    .addEventListener('hf:grant', () => dropTable());
</script>
```

## Attributes

| Attribute | Type | Description |
|---|---|---|
| `label` | string | Action description shown in overlay |
| `severity` | `caution` \| `danger` \| `critical` | Preset configuration |
| `sync-ms` | number | Override sync hold duration |
| `commit-ms` | number | Override commit hold duration |
| `window-ms` | number | Override privilege window |
| `lock-ms` | number | Override first breach lockout |
| `storage-key` | string | localStorage persistence key |

## Events

| Event | Detail | Description |
|---|---|---|
| `hf:grant` | GateSnapshot | Permission earned — execute action |
| `hf:breach` | GateSnapshot | Breach — penalty applied |
| `hf:sync` | GateSnapshot | Sync hold passed |
| `hf:locked` | GateSnapshot | Cooldown started |
| `hf:expired` | GateSnapshot | LIVE window ended |
| `hf:cancel` | null | User cancelled |

## Programmatic

```js
const el = document.querySelector('holdfast-gate');
el.open();   // open overlay manually
el.close();  // close overlay
```

See root [README](../../README.md) for full API.
