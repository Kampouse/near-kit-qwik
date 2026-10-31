# near-kit-qwik

Qwik-friendly functional wrapper around [near-kit](https://github.com/r-near/near-kit).

**The problem:** Qwik's resumability serializes app state into HTML. Class instances — like near-kit's `Near` client or `NearConnector` — cannot survive a serialization boundary. Worse, they fail **silently**: Qwik drops them from the serialized state with no build-time or SSR error, and the app only breaks at click time in the browser (`near.view is not a function`).

**The fix:** store the config, not the client. Every export here is a **hoisted function** taking a JSON-serializable config. The `Near` instance is born inside the call and dies when it returns. Nothing but pure JSON ever crosses Qwik's serializer.

```
✅ verified: Qwik 1.20.3 SSR + live NEAR testnet RPC through this exact wrapper
❌ without it: useStore(new Near(...)) → qwik/json objs: [] → dead husk at click time
```

## Install

```bash
npm i near-kit-qwik
# peers, if not already present:
npm i near-kit @hot-labs/near-connect
```

Source-distributed (plain `.ts`) — your Vite/Qwik pipeline compiles it, no build step needed.

## Usage

```tsx
import { component$, useStore, $ } from "@builder.io/qwik";
import { view, call, connect, type NearConfig } from "near-kit-qwik";

export const SwapCard = component$(() => {
  // JSON only. This survives pause/resume/serialization forever.
  const cfg = useStore<NearConfig & { balance?: string }>({
    network: "testnet",
    accountId: "",
  });

  const connect$ = $(async () => {
    cfg.accountId = await connect(cfg); // store the ID, never the wallet
  });

  const refresh$ = $(async () => {
    cfg.balance = await view(cfg, "wrap.testnet", "ft_balance_of", {
      account_id: cfg.accountId,
    }) as string;
  });

  const swap$ = $(async () => {
    // instance born inside the QRL, dies after — nothing captured but JSON
    await call(cfg, "pool7.your.near", "swap",
      { amount_in: "1000000" }, { attachedDeposit: "1 NEAR" });
  });

  return (
    <div>
      {cfg.accountId
        ? <button onClick$={swap$}>Swap</button>
        : <button onClick$={connect$}>Connect</button>}
      <span>{cfg.balance}</span>
    </div>
  );
});
```

## API

| Function | Signature | Wallet |
|---|---|---|
| `view` | `(cfg, contractId, method, args)` | no — free RPC read |
| `call` | `(cfg, contractId, method, args, { attachedDeposit? })` | yes |
| `send` | `(cfg, to, amount: AmountInput)` | yes |
| `batch` | `(cfg, ops: Op[])` — atomic multi-action tx | yes |
| `getBalance` | `(cfg, accountId)` | no |
| `getStatus` | `(cfg)` | no |
| `accountExists` | `(cfg, accountId)` | no |
| `connect` | `(cfg) → Promise<accountId>` | opens wallet selector |
| `getSession` | `(cfg) → Promise<accountId \| null>` — restore after reload | reads session |
| `disconnect` | `(cfg) → Promise<boolean>` | closes session |
| `signMessage` | `(cfg, { message, recipient, nonceHex })` — NEP-413 gasless auth | yes |
| `newNonce` | `() → 64-char hex` — build NEP-413 nonces in stores | no |

Session-restore pattern (call in `useVisibleTask$`):

```tsx
useVisibleTask$(() => { cfg.accountId = await getSession(cfg) ?? cfg.accountId; });
```

Batch example (all ops atomic — one signature, all-or-nothing):

```ts
await batch(cfg, [
  { kind: "transfer", to: "bob.near", amount: "1 NEAR" },
  { kind: "call", contract: "pool.near", method: "swap", args: { amount_in: "1" }, deposit: "1 NEAR" },
]);
```

`AmountInput` = `` `${number} NEAR` `` | `` `${bigint} yocto` `` | `bigint` (mirrors near-kit's internal type, which isn't re-exported as of 0.20.2).

## The three laws

1. **Every export is a hoisted top-level function** — a static import reference, exactly what a QRL serializes.
2. **Every argument is JSON** — config, contract IDs, args, deposits. Signals/stores hold only this shape.
3. **The client is born inside the call and never escapes** — no closures over instances, no instances in state, ever.

## Example

`example-routes/index.tsx` is the verified demo route (server-side `routeLoader$` pulling a live testnet balance through the wrapper). Copy it into any Qwik City app's `src/routes/`.

## Verified against

- Qwik 1.20.3 (`vite preview` SSR, resumability on)
- near-kit >=0.20.2 (uses fromNearConnect, not the deprecated fromHotConnect alias) / @hot-labs/near-connect
- NEAR testnet: `getBalance` + `ft_balance_of` live through the full SSR → serialize → resume path

## License

MIT

## Testing against near-mock (no testnet, no funds)

The wrapper accepts a custom network — `{ rpcUrl, networkId }` — so you can point
the whole frontend at a local deterministic chain:

```ts
const cfg: NearConfig = { network: { rpcUrl: "http://127.0.0.1:3030", networkId: "mock" } };
```

Run the shim (Node, zero deps): it speaks the NEAR JSON-RPC subset on :3030 and
translates view calls into `near-mock` executions of a real contract wasm against
a local `state.bin`:

```bash
# 1. capture a contract (mainnet default; testnet needs NEAR_RPC_URL)
near-mock snapshot wrap.near state.bin
# (or on testnet: NEAR_RPC_URL=https://rpc.testnet.near.org near-mock snapshot acct.testnet state.bin)

# 2. run the shim
CONTRACT=wrap.near WASM=wrap.wasm STATE=state.bin node mock/mock-rpc.mjs

# 3. dev against it
npm run dev
```

Deterministic: reset = delete the state file or re-snapshot. Signatures are
ignored (the mock applies calls directly) — test/demo only, never point this at
real keys. Wallet-signed writes bypass the shim (they go to the wallet's own RPC).
