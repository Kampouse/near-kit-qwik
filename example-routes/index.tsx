import { component$, useStore, $ } from "@builder.io/qwik";
import { routeLoader$, type DocumentHead } from "@builder.io/qwik-city";
import { getBalance, view, getStatus, type NearConfig } from "~/lib/near-kit-qwik";

// Route loader runs on the SERVER (at build/SSG time): it calls the
// wrapper, and its JSON result is what Qwik serializes into the HTML.
export const useBalance = routeLoader$(async () => {
  const cfg: NearConfig = { network: "testnet" };
  const balance = await getBalance(cfg, "lff2.clmm5-51fe5a.testnet");
  // a real contract view through the same wrapper
  const ft = await view(
    cfg,
    "wrap.testnet",
    "ft_balance_of",
    { account_id: "lff2.clmm5-51fe5a.testnet" },
  );
  return { balance, ft: typeof ft === "string" ? ft : JSON.stringify(ft) };
});

export default component$(() => {
  // JSON only — the sole resident of Qwik's serialized state
  const cfg = useStore<NearConfig & { clicked: number }>({
    network: "testnet",
    accountId: "",
    clicked: 0,
  });

  const ping$ = $(async () => {
    // wrapper called INSIDE the QRL: instance born here, dies here,
    // nothing captured except the JSON store
    await getStatus(cfg);
    cfg.clicked++;
  });

  return (
    <>
      <h1>near-kit-qwik live test</h1>
      <p>Network: {cfg.network}</p>
      <p>
        lff2 balance (server-side via wrapper, serialized into HTML):{" "}
        <b>{useBalance().value.balance} N</b>
      </p>
      <p>wrap.testnet FT balance: {String(useBalance().value.ft)}</p>
      <button onClick$={ping$}>ping testnet status ({cfg.clicked})</button>
      <p>Store JSON (what Qwik serializes — no class instances):</p>
      <pre>{JSON.stringify(cfg)}</pre>
    </>
  );
});

export const head: DocumentHead = {
  title: "near-kit-qwik test",
};
