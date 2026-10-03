import { deriveMetadataAddress, base58Encode, isOnCurve } from "../src/lib/solana/address";

const mints = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
  "So11111111111111111111111111111111111111112", // wrapped SOL
];

async function rpc(method: string, params: unknown[]) {
  const res = await fetch("https://api.mainnet-beta.solana.com", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

for (const mint of mints) {
  const { address } = deriveMetadataAddress(mint);
  const json = await rpc("getAccountInfo", [address, { encoding: "base64" }]);
  const value = json?.result?.value;
  if (!value) { console.log(mint, "->", address, "NO ACCOUNT"); continue; }
  const raw = Buffer.from(value.data[0], "base64");
  // TokenMetadata: key u8, updateAuthority 32, mint 32, then 4-byte-len name
  const mintInAccount = base58Encode(raw.subarray(33, 65));
  const nameLen = raw.readUInt32LE(65);
  const name = raw.subarray(69, 69 + nameLen).toString("utf8").replace(/\0+$/, "");
  console.log(mint, "->", address);
  console.log("   owner:", value.owner, "mintInAccount:", mintInAccount, "match:", mintInAccount === mint, "name:", JSON.stringify(name));
}
console.log("isOnCurve sanity (all-ff => false):", isOnCurve(new Uint8Array(32).fill(255)));
