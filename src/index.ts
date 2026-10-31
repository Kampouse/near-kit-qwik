import { Near, fromNearConnect } from "near-kit";
import { NearConnector } from "@hot-labs/near-connect";

// Structurally identical to near-kit's internal AmountInput
// (not re-exported from the package root as of 0.20.2).
export type AmountInput = `${number} NEAR` | `${bigint} yocto` | bigint;

// The only thing Qwik ever stores. 100% JSON.
export type NearNetwork =
  | "mainnet" | "testnet" | "localnet" | "betanet"
  | { rpcUrl: string; networkId: string };  // e.g. near-mock shim: { rpcUrl: "http://127.0.0.1:3030", networkId: "mock" }

export interface NearConfig {
  network: NearNetwork;
  accountId?: string;
}

// JSON-safe NEP-413 nonce: 32 bytes as 64 hex chars (use newNonce()).
export interface SignMessageArgs {
  message: string;
  recipient: string;
  nonceHex: string; // 64 hex chars = 32 bytes
}

export interface SignedMessage {
  accountId: string;
  publicKey: string;
  signatureHex: string; // hex for JSON transport — decode server-side
}

// JSON-safe action list for atomic multi-action transactions.
export type Op =
  | { kind: "transfer"; to: string; amount: AmountInput }
  | {
      kind: "call";
      contract: string;
      method: string;
      args: object;
      deposit?: AmountInput;
    };

export const useMockNetwork = (): NearNetwork => {
  const env = (globalThis as unknown as { MOCK_RPC_URL?: string }) ?? {};
  return { rpcUrl: env.MOCK_RPC_URL ?? "http://127.0.0.1:3030", networkId: "mock" };
};

// Law: every export is a hoisted function, every arg is JSON,
// the Near instance is born inside the call and never escapes.

function clientOf(cfg: NearConfig, wallet?: unknown): Near {
  return new Near({
    // near-kit's zod schema accepts { rpcUrl, networkId } at runtime;
    // its published TS alias predates that union, so one cast lives here.
    network: cfg.network as unknown as "mainnet",
    ...(wallet ? { wallet } : {}),
  });
}

// ── free reads (no wallet) ───────────────────────────────────

export const view = async (
  cfg: NearConfig,
  contractId: string,
  method: string,
  args: object,
): Promise<unknown> => {
  const near = clientOf(cfg);
  return near.view(contractId, method, args);
};

export const getBalance = (cfg: NearConfig, accountId: string): Promise<string> =>
  clientOf(cfg).getBalance(accountId);

export const getStatus = (cfg: NearConfig) =>
  clientOf(cfg).getStatus();

export const accountExists = (cfg: NearConfig, accountId: string): Promise<boolean> =>
  clientOf(cfg).accountExists(accountId);

// ── wallet session (JSON in, accountId out) ──────────────────

function connectorOf(cfg: NearConfig): NearConnector {
  return new NearConnector({
    network: cfg.network as unknown as "mainnet",
  });
}

function walletNear(cfg: NearConfig): Near {
  return clientOf(cfg, fromNearConnect(connectorOf(cfg)));
}

/** Opens the wallet selector. Resolves to the accountId to store. */
export const connect = async (cfg: NearConfig): Promise<string> => {
  const connector = connectorOf(cfg);
  await connector.connect();
  const { accounts } = await connector.getConnectedWallet();
  return accounts[0]?.accountId ?? "";
};

/** Restores the session after a page reload. Null if not connected. */
export const getSession = async (cfg: NearConfig): Promise<string | null> => {
  try {
    const { accounts } = await connectorOf(cfg).getConnectedWallet();
    return accounts[0]?.accountId ?? null;
  } catch {
    return null;
  }
};

/** Disconnects the wallet. Boolean = cleanly disconnected. */
export const disconnect = async (cfg: NearConfig): Promise<boolean> => {
  try {
    await connectorOf(cfg).disconnect();
    return true;
  } catch {
    return false;
  }
};

// ── signed operations ────────────────────────────────────────

/** Builds the JSON args for the QRL store; bytes stay out of state. */
export const newNonce = (): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
};

/** NEP-413 gasless message signing — logins without transactions. */
export const signMessage = async (
  cfg: NearConfig,
  args: SignMessageArgs,
): Promise<SignedMessage> => {
  if (args.nonceHex.length !== 64) throw new Error("nonceHex must be 64 hex chars (32 bytes)");
  const nonce = new Uint8Array(
    (args.nonceHex.match(/../g) ?? []).map((h) => parseInt(h, 16)),
  );
  const near = clientOf(cfg, fromNearConnect(connectorOf(cfg)));
  const signed = (await near.signMessage({
    message: args.message,
    recipient: args.recipient,
    nonce,
  })) as unknown as Record<string, unknown>;
  return {
    accountId: String(signed.accountId ?? ""),
    publicKey: String(signed.publicKey ?? ""),
    signatureHex: hexOf(signed.signature),
  };
};

function hexOf(sig: unknown): string {
  if (typeof sig === "string") return sig;
  if (sig instanceof Uint8Array)
    return Array.from(sig, (b) => b.toString(16).padStart(2, "0")).join("");
  return String(sig ?? "");
}

// ── transactions ─────────────────────────────────────────────

export const call = async (
  cfg: NearConfig,
  contractId: string,
  method: string,
  args: object,
  opts: { attachedDeposit?: AmountInput } = {},
): Promise<unknown> => walletNear(cfg).call(contractId, method, args, opts);

export const send = async (
  cfg: NearConfig,
  to: string,
  amount: AmountInput,
): Promise<unknown> => walletNear(cfg).send(to, amount);

/**
 * Atomic multi-action transaction from a JSON op list.
 * All ops succeed or the whole batch reverts.
 */
export const batch = async (cfg: NearConfig, ops: Op[]): Promise<unknown> => {
  if (!cfg.accountId) throw new Error("batch: cfg.accountId required (connect first)");
  const near = walletNear(cfg);
  let tx = near.transaction(cfg.accountId);
  for (const op of ops) {
    if (op.kind === "transfer") {
      tx = tx.transfer(op.to, op.amount);
    } else {
      tx = tx.functionCall(op.contract, op.method, op.args, {
        attachedDeposit: op.deposit ?? ("0 yocto" as AmountInput),
      });
    }
  }
  return tx.send();
};
