#!/usr/bin/env node

/**
 * Deploy contracts/sentinelpact.py to GenLayer Studionet (chain 61999).
 *
 *   node scripts/deploy_studionet.mjs
 *
 * Uses GENLAYER_PRIVATE_KEY when provided. Otherwise it generates a throwaway
 * Studio account and funds it through the Studio faucet (sim_fundAccount),
 * which is only available on Studionet.
 *
 * On success it prints the deployed address and the finalized transaction, and
 * updates deployments/studionet.json.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { createAccount, createClient } from "genlayer-js";
import { studionet } from "genlayer-js/chains";

const RPC = "https://studio.genlayer.com/api";
const CONTRACT_PATH = "contracts/sentinelpact.py";
const RECORD_PATH = "deployments/studionet.json";
const FUND_AMOUNT = 500n * 10n ** 18n;

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${JSON.stringify(body.error)}`);
  return body.result;
}

const privateKey = process.env.GENLAYER_PRIVATE_KEY?.trim();
const account = privateKey ? createAccount(privateKey) : createAccount();
console.log(`Deployer : ${account.address}`);
console.log(`Network  : GenLayer Studionet (chain ${studionet.id})`);

if (!privateKey) {
  console.log("Funding the throwaway deployer through the Studio faucet…");
  await rpc("sim_fundAccount", [account.address, Number(FUND_AMOUNT)]);
}

const client = createClient({ chain: studionet, account, endpoint: RPC });
const code = readFileSync(CONTRACT_PATH);
console.log(`Deploying ${CONTRACT_PATH} (${code.length} bytes)…`);

const txHash = await client.deployContract({ code, args: [] });
console.log(`Deployment transaction: ${txHash}`);

const receipt = await client.waitForTransactionReceipt({
  hash: txHash,
  status: "FINALIZED",
  interval: 4000,
  retries: 200,
  fullTransaction: true,
});

const status = receipt?.statusName ?? receipt?.status;
const address =
  receipt?.data?.contract_address ??
  receipt?.contract_address ??
  receipt?.recipient ??
  receipt?.to_address;

if (!address) {
  console.error("Finalized but no contract address was present in the receipt.");
  process.exit(1);
}

console.log(`Status   : ${status}`);
console.log(`Contract : ${address}`);

const stats = await client.readContract({ address, functionName: "get_stats", args: [] });
const plain = stats instanceof Map ? Object.fromEntries(stats) : stats;
console.log(`Version  : ${plain.version}`);

const record = JSON.parse(readFileSync(RECORD_PATH, "utf8"));
record.contract.version = plain.version;
record.deployment = {
  address,
  transaction: String(txHash),
  explorerUrl: `https://explorer-studio.genlayer.com/address/${address}`,
  transactionUrl: `https://explorer-studio.genlayer.com/tx/${txHash}`,
  deployedAt: new Date().toISOString(),
  deployer: account.address,
  status: "live",
};
writeFileSync(RECORD_PATH, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Updated ${RECORD_PATH}`);
console.log(`\nSet this in your environment and rebuild:\n  NEXT_PUBLIC_SENTINELPACT_CONTRACT=${address}`);
