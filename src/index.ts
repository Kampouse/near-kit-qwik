import { Near, fromHotConnect } from "near-kit";
import { NearConnector } from "@hot-labs/near-connect";

// Structurally identical to near-kit's internal AmountInput
// (not re-exported from the package root as of 0.20.2).
export type AmountInput = `${number} NEAR` | `${bigint} yocto` | bigint;

// The only thing Qwik ever stores. 100% JSON.
export interface NearConfig {
  network: "mainnet" | "testnet";
  accountId?: string;
}

// Law: every export is a hoisted function, every arg is JSON,
// the Near instance is born inside the call and never escapes.

export const view = async (
  cfg: NearConfig,
  contractId: string,
  method: string,
  args: object,
): Promise<unknown> => {
  const near = new Near({ network: cfg.network });
  return near.view(contractId, method, args);
};

export const call = async (
  cfg: NearConfig,
  contractId: string,
  method: string,
  args: object,
  opts: { attachedDeposit?: AmountInput } = {},
): Promise<unknown> => {
  const connector = new NearConnector({ network: cfg.network });
  const near = new Near({
    network: cfg.network,
    wallet: fromHotConnect(connector),
  });
  return near.call(contractId, method, args, opts);
};

export const send = async (
  cfg: NearConfig,
  to: string,
  amount: AmountInput,
): Promise<unknown> => {
  const connector = new NearConnector({ network: cfg.network });
  const near = new Near({
    network: cfg.network,
    wallet: fromHotConnect(connector),
  });
  return near.send(to, amount);
};

export const getBalance = (cfg: NearConfig, accountId: string): Promise<string> =>
  new Near({ network: cfg.network }).getBalance(accountId);

export const getStatus = (cfg: NearConfig) =>
  new Near({ network: cfg.network }).getStatus();

/** Wallet handshake — resolves to the accountId to store in your Qwik store */
export const connect = async (cfg: NearConfig): Promise<string> => {
  const connector = new NearConnector({ network: cfg.network });
  await connector.connect();
  const { accounts } = await connector.getConnectedWallet();
  return accounts[0]?.accountId ?? "";
};
