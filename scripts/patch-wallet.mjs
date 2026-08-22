import fs from "node:fs";

let s = fs.readFileSync("src/hooks/useWallet.tsx", "utf8");

// Interface additions
s = s.replace(
  `  createWallet: (
    password: string,
    opts?: { secret?: string; label?: string },
  ) => Promise<{ account: AccountMeta; revealedSecret: string }>;`,
  `  createWallet: (
    password: string,
    opts?: { secret?: string; mnemonic?: string; label?: string },
  ) => Promise<{ account: AccountMeta; revealed: string; kind: "mnemonic" | "secret" }>;
  revealRecoveryPhrase: (password: string) => Promise<string>;`,
);

// imports
s = s.replace("import {\n  addStoredAccount,", "import {\n  addStoredAccount,\n  hasMnemonic,\n  revealMnemonic as revealMnemonicVault,");
s = s.replace(
  'import type { InitializeOptions } from "@/lib/vault";\n',
  "",
);
s = s.replace(
  '} from "@/lib/vault";',
  '  type InitializeOptions,\n} from "@/lib/vault";',
);

// createWallet implementation
const cwOld = `  const createWallet = useCallback(
    async (password: string, opts?: { secret?: string; label?: string }) => {
      const { account, revealedSecret } = await initializeVault(password, opts);
      setAccounts([account]);
      setActiveId(account.id);
      setBalances(null);
      setActivity([]);
      return { account, revealedSecret };
    },
    [],
  );`;
const cwOld2 = cwOld.replace("setAccounts([stripSecret(account)]);", "setAccounts([stripSecret(account)]);");
const cwNew = `  const createWallet = useCallback(
    async (
      password: string,
      opts?: { secret?: string; mnemonic?: string; label?: string },
    ) => {
      const initOpts: InitializeOptions = {};
      if (opts?.secret) initOpts.secret = opts.secret;
      if (opts?.mnemonic) initOpts.mnemonic = opts.mnemonic;
      const { account, revealed } = await initializeVault(password, initOpts);
      setAccounts([stripSecret(account)]);
      setActiveId(account.id);
      setBalances(null);
      setActivity([]);
      return {
        account,
        revealed,
        kind: (hasMnemonic() ? "mnemonic" : "secret") as "mnemonic" | "secret",
      };
    },
    [],
  );

  const revealRecoveryPhrase = useCallback(async (password: string) => {
    return revealMnemonicVault(password);
  }, []);`;

if (s.includes(cwOld)) s = s.replace(cwOld, cwNew);
else if (s.includes(cwOld2)) s = s.replace(cwOld2, cwNew);
else throw new Error("createWallet block not found");

// stripSecret keeps index/path
s = s.replace(
  `function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
  };
}`,
  `function stripSecret(account: StoredAccount): AccountMeta {
  return {
    id: account.id,
    label: account.label,
    publicKey: account.publicKey,
    createdAt: account.createdAt,
    ...(account.index !== undefined ? { index: account.index, path: account.path } : {}),
  };
}`,
);

// context value + deps
s = s.replace("      createWallet,\n      completeSetup,", "      createWallet,\n      revealRecoveryPhrase,\n      completeSetup,");

fs.writeFileSync("src/hooks/useWallet.tsx", s);
console.log("useWallet patched");
