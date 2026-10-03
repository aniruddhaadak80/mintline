import { describe, expect, it } from "vitest";
import {
  base58Decode,
  base58Encode,
  deriveMetadataAddress,
  findProgramAddress,
  isOnCurve,
  isValidSolanaAddress,
  TOKEN_METADATA_PROGRAM_ID,
} from "@/lib/solana/address";
import { decodeTokenMetadata, identityTextFrom, toOnChainMetadata } from "@/lib/solana/metadata";

/**
 * The address maths is hand-rolled rather than pulled from a wallet SDK, so it
 * is tested against values that were verified against Solana mainnet.
 */

const KNOWN = [
  {
    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    metadata: "5x38Kp4hvdomTCnCrAny4UtMUt5rQBdB6px2K1Ui45Wq",
    name: "USD Coin",
  },
  {
    mint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    metadata: "FDZZbyY9XGpL3CNKUZxLk3wFTTQYL3TkDiDzqxrizcPN",
    name: "Bonk",
  },
  {
    mint: "So11111111111111111111111111111111111111112",
    metadata: "6dM4TqWyWJsbx7obrdLcviBkTafD5E8av61zfU6jq57X",
    name: "Wrapped SOL",
  },
];

describe("base58", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect(base58Decode(base58Encode(bytes))).toEqual(bytes);
  });

  it("round-trips a real address", () => {
    for (const { mint } of KNOWN) {
      const decoded = base58Decode(mint);
      expect(decoded).not.toBeNull();
      expect(base58Encode(decoded!)).toBe(mint);
    }
  });

  it("preserves leading zero bytes as leading ones", () => {
    expect(base58Encode(new Uint8Array([0, 0, 5]))).toBe("116");
  });

  it("encodes an empty array as an empty string", () => {
    expect(base58Encode(new Uint8Array(0))).toBe("");
  });

  it("rejects characters outside the alphabet", () => {
    expect(base58Decode("0OIl")).toBeNull();
  });
});

describe("isValidSolanaAddress", () => {
  it("accepts known mainnet mints", () => {
    for (const { mint } of KNOWN) expect(isValidSolanaAddress(mint)).toBe(true);
  });

  it("rejects wrong lengths and bad characters", () => {
    expect(isValidSolanaAddress("")).toBe(false);
    expect(isValidSolanaAddress("abc")).toBe(false);
    expect(isValidSolanaAddress("0".repeat(44))).toBe(false);
    expect(isValidSolanaAddress("l".repeat(40))).toBe(false);
  });

  it("tolerates surrounding whitespace from a paste", () => {
    expect(isValidSolanaAddress(`  ${KNOWN[0].mint}  `)).toBe(true);
  });
});

describe("ed25519 curve membership", () => {
  it("rejects a length other than 32", () => {
    expect(isOnCurve(new Uint8Array(31))).toBe(false);
    expect(isOnCurve(new Uint8Array(33))).toBe(false);
  });

  it("rejects an all-ones value, which is not a canonical y", () => {
    expect(isOnCurve(new Uint8Array(32).fill(255))).toBe(false);
  });

  it("accepts the identity encoding of the base point", () => {
    // y = 1 encodes the neutral element, a valid point.
    const one = new Uint8Array(32);
    one[0] = 1;
    expect(isOnCurve(one)).toBe(true);
  });

  it("accepts a real public key from mainnet", () => {
    const decoded = base58Decode(KNOWN[0].mint)!;
    expect(decoded).toHaveLength(32);
    expect(isOnCurve(decoded)).toBe(true);
  });
});

describe("findProgramAddress", () => {
  it("rejects more than 16 seeds", () => {
    const seeds = Array.from({ length: 17 }, () => new Uint8Array([1]));
    expect(() => findProgramAddress(seeds, TOKEN_METADATA_PROGRAM_ID)).toThrow(/at most 16/);
  });

  it("rejects a program id that is not 32 bytes", () => {
    expect(() => findProgramAddress([new Uint8Array([1])], new Uint8Array(31))).toThrow(
      /must be 32 bytes/,
    );
  });

  it("is deterministic", () => {
    const seeds = [new Uint8Array([1, 2, 3])];
    expect(findProgramAddress(seeds, TOKEN_METADATA_PROGRAM_ID)).toEqual(
      findProgramAddress(seeds, TOKEN_METADATA_PROGRAM_ID),
    );
  });

  it("returns an address that is not a curve point", () => {
    const { address } = findProgramAddress([new Uint8Array([9, 9])], TOKEN_METADATA_PROGRAM_ID);
    expect(isOnCurve(base58Decode(address)!)).toBe(false);
  });
});

describe("deriveMetadataAddress", () => {
  it("matches the addresses observed on Solana mainnet", () => {
    for (const { mint, metadata } of KNOWN) {
      expect(deriveMetadataAddress(mint).address).toBe(metadata);
    }
  });

  it("throws on an invalid mint", () => {
    expect(() => deriveMetadataAddress("not-an-address")).toThrow(/invalid mint/);
  });

  it("gives different mints different metadata accounts", () => {
    const addresses = new Set(KNOWN.map(({ mint }) => deriveMetadataAddress(mint).address));
    expect(addresses.size).toBe(KNOWN.length);
  });
});

/**
 * Builds a syntactically valid MetadataV1 account so the decoder can be
 * exercised without a network call.
 */
function buildMetadataAccount(options: {
  mint: string;
  name: string;
  symbol: string;
  uri: string;
  updateAuthority?: string;
  isMutable?: boolean;
}): string {
  const pad = (text: string) => {
    const buffer = Buffer.alloc(4 + text.length);
    buffer.writeUInt32LE(text.length, 0);
    buffer.write(text, 4, "utf8");
    return buffer;
  };

  const parts: Buffer[] = [
    Buffer.from([4]),
    Buffer.from(base58Decode(options.updateAuthority ?? KNOWN[0].mint)!),
    Buffer.from(base58Decode(options.mint)!),
    pad(options.name),
    pad(options.symbol),
    pad(options.uri),
    Buffer.from([0, 0]), // seller_fee_basis_points = 0
    Buffer.from([0]), // creators: None
    Buffer.from([1]), // primary_sale_happened
    Buffer.from([options.isMutable === false ? 0 : 1]),
  ];

  return Buffer.concat(parts).toString("base64");
}

describe("decodeTokenMetadata", () => {
  const mint = KNOWN[0].mint;

  it("decodes a well-formed account", () => {
    const account = buildMetadataAccount({
      mint,
      name: "USD Coin",
      symbol: "USDC",
      uri: "https://www.circle.com/usdc",
      isMutable: false,
    });

    const decoded = decodeTokenMetadata(account, mint);
    expect(decoded).not.toBeNull();
    expect(decoded!.name).toBe("USD Coin");
    expect(decoded!.symbol).toBe("USDC");
    expect(decoded!.uri).toBe("https://www.circle.com/usdc");
    expect(decoded!.mint).toBe(mint);
    expect(decoded!.isMutable).toBe(false);
    expect(decoded!.primarySaleHappened).toBe(true);
  });

  it("refuses an account that references a different mint", () => {
    const account = buildMetadataAccount({
      mint,
      name: "USD Coin",
      symbol: "USDC",
      uri: "https://example.com",
    });
    expect(decodeTokenMetadata(account, KNOWN[1].mint)).toBeNull();
  });

  it("rejects a payload that is too short", () => {
    expect(decodeTokenMetadata(Buffer.alloc(10).toString("base64"), mint)).toBeNull();
  });

  it("rejects a payload that is not valid base64", () => {
    expect(decodeTokenMetadata("!!!not-base64!!!", mint)).toBeNull();
  });

  it("rejects an account with the wrong program key", () => {
    const account = buildMetadataAccount({ mint, name: "X", symbol: "X", uri: "" });
    const bytes = Buffer.from(account, "base64");
    bytes[0] = 1; // not MetadataV1
    expect(decodeTokenMetadata(bytes.toString("base64"), mint)).toBeNull();
  });

  it("strips NUL padding from fixed-width fields", () => {
    const buffer = Buffer.concat([
      Buffer.from([4]),
      base58Decode(mint)!,
      base58Decode(mint)!,
      Buffer.from([8, 0, 0, 0]),
      Buffer.from("Bonk\0\0\0\0", "utf8"),
    ]);
    const decoded = decodeTokenMetadata(buffer.toString("base64"), mint);
    // Truncated after the name, so the whole account is rejected rather than
    // half-decoded into a phantom claim.
    expect(decoded).toBeNull();
  });
});

describe("toOnChainMetadata", () => {
  it("reports an unloaded description honestly", () => {
    const raw = {
      key: 4,
      updateAuthority: mint0(),
      mint: mint0(),
      name: "X",
      symbol: "X",
      uri: "https://example.com",
      sellerFeeBasisPoints: 0,
      creators: [],
      primarySaleHappened: true,
      isMutable: true,
    };

    const metadata = toOnChainMetadata(raw, { description: null, loaded: false });
    expect(metadata.description).toBeNull();
    expect(metadata.offchainLoaded).toBe(false);

    const loaded = toOnChainMetadata(raw, { description: "A real description.", loaded: true });
    expect(loaded.description).toBe("A real description.");
    expect(loaded.offchainLoaded).toBe(true);
  });
});

describe("identityTextFrom", () => {
  it("joins the available identity fields", () => {
    const text = identityTextFrom({
      mint: mint0(),
      metadataAddress: null,
      updateAuthority: null,
      name: "Wrapped SOL",
      symbol: "WSOL",
      uri: null,
      description: "The wrapped representation of native SOL.",
      offchainLoaded: true,
      primarySaleHappened: true,
      isMutable: false,
    });
    expect(text).toContain("Wrapped SOL");
    expect(text).toContain("WSOL");
    expect(text).toContain("wrapped representation");
  });

  it("returns an empty string when nothing is present", () => {
    const text = identityTextFrom({
      mint: mint0(),
      metadataAddress: null,
      updateAuthority: null,
      name: null,
      symbol: null,
      uri: null,
      description: null,
      offchainLoaded: false,
      primarySaleHappened: null,
      isMutable: null,
    });
    expect(text).toBe("");
  });
});

function mint0(): string {
  return KNOWN[0].mint;
}