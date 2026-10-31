// mock-rpc shim: NEAR JSON-RPC subset → near-mock (wasmtime, state.bin)
// Usage: CONTRACT=pool7.clmm5-51fe5a.testnet WASM=pool7.wasm STATE=pool7.bin node mock-rpc.mjs
import http from "node:http";
import { execFileSync } from "node:child_process";

const CONTRACT = process.env.CONTRACT ?? "pool7.clmm5-51fe5a.testnet";
const WASM = process.env.WASM ?? "pool7.wasm";
const STATE = process.env.STATE ?? "pool7.bin";
const MOCK = process.env.NEAR_MOCK ?? `${process.env.HOME}/dev/lisp-rlm/target/release/near-mock`;
const PORT = Number(process.env.PORT ?? 3030);
let height = 1000;

function b64(s) { return Buffer.from(s, "utf8").toString("base64"); }
function unb64(s) { return Buffer.from(s, "base64").toString("utf8"); }

/** Run one contract call in near-mock. mutate=false → --view (no persist). */
function mockCall(method, argsJson, mutate) {
  const args = typeof argsJson === "string" ? argsJson : JSON.stringify(argsJson ?? {});
  const argsFlag = args === "{}" ? [] : [args];
  const out = execFileSync(MOCK, [
    "cross", STATE, `${CONTRACT}=${WASM}`, CONTRACT, method, ...argsFlag,
    ...(mutate ? [] : ["--view"]), "--json",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const line = out.split("\n").find((l) => l.startsWith("JSON "));
  if (!line) throw new Error(`near-mock produced no JSON line: ${out.slice(0, 400)}`);
  return JSON.parse(line.slice(5));
}

function jsonOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}
function jsonErr(id, code, message, cause) {
  return { jsonrpc: "2.0", id, error: { code, message, data: cause } };
}

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    let rpc;
    try { rpc = JSON.parse(body); } catch { res.writeHead(400); return res.end("{}"); }
    const { id, method, params } = rpc;
    try {
      if (method === "status") {
        return end(res, jsonOk(id, {
          chain_id: "mock", latest_block_height: ++height,
          latest_block_hash: Buffer.from(`mock${height}`).toString("base64").slice(0, 44),
          sync_info: { latest_block_height: height, syncing: false },
          versions: { version: "MOCK" },
        }));
      }
      if (method === "block" || method === "chunk") {
        return end(res, jsonOk(id, { header: { height: ++height, hash: "mock" } }));
      }
      if (method === "query") {
        const t = params.request_type;
        if (t === "view_account") {
          return end(res, jsonOk(id, {
            account_id: params.account_id,
            amount: "100000000000000000000000000",
            locked: "0", code_hash: "mockcodehash0000000000000000000000000000",
            storage_usage: 14805, storage_paid_at: 0,
            block_height: height, block_hash: "mock",
            logs: [],
          }));
        }
        if (t === "call_function") {
          const methodName = params.method_name;
          const args = unb64(params.args_base64);
          const mutate = params.mutate === true; // shim extension: default read-only
          const outcome = mockCall(methodName, args, mutate);
          if (outcome.outcome !== "ok" && outcome.entry_trapped) {
            return end(res, jsonErr(id, -32000, "ServerError", {
              name: "ACTION_VALIDATION_ERROR", cause: "mock trap",
              panic: outcome.error ?? "trap", logs: outcome.logs ?? [],
            }));
          }
          return end(res, jsonOk(id, {
            result: Array.from(Buffer.from(outcome.return ?? "", "utf8")),
            logs: Array.isArray(outcome.logs) ? outcome.logs : [],
            block_height: height, block_hash: "mock",
          }));
        }
        if (t === "view_state") {
          return end(res, jsonOk(id, { values: [], proof: [] }));
        }
        return end(res, jsonErr(id, -32601, `unsupported query type: ${t}`));
      }
      if (method === "broadcast_tx_commit" || method === "broadcast_tx_async") {
        // near-kit signs and submits; the mock ignores signatures and applies
        // the (first) function-call action directly. Demo/test only.
        const tx = params.transaction ?? {};
        const actions = tx.actions ?? [];
        const fc = actions.find((a) => a.FunctionCall) ?.FunctionCall;
        if (!fc) return end(res, jsonErr(id, -32601, "mock tx shim: only FunctionCall actions"));
        const args = unb64(fc.args);
        const outcome = mockCall(fc.method_name, args, true);
        return end(res, jsonOk(id, {
          status: outcome.outcome === "ok"
            ? { SuccessValue: b64(outcome.return ?? "") }
            : { Failure: { error_message: outcome.error ?? "trap" } },
          transaction_outcome: { outcome: { status: { SuccessReceiptId: "mock-receipt" }, logs: [] } },
          receipts_outcome: [],
          transaction: tx,
        }));
      }
      return end(res, jsonErr(id, -32601, `unsupported method: ${method}`));
    } catch (e) {
      return end(res, jsonErr(id, -32000, String(e.message ?? e).slice(0, 500)));
    }
  });
  function end(res, obj) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(obj));
  }
});
server.listen(PORT, () => console.log(`mock-rpc shim on http://127.0.0.1:${PORT} → near-mock ${STATE} (${CONTRACT})`));
