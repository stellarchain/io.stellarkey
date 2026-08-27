import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => readFileSync(path.join(root, relativePath), "utf8");

test("local-device signer badges sit below their addresses", () => {
  const multisig = read("src/components/MultiSigStudioModal.tsx");
  const separatedBadges = multisig.match(
    /className="mt-1 block w-fit rounded-md bg-\[#30D158\]\/15/g,
  );

  assert.equal(separatedBadges?.length ?? 0, 2);
  assert.doesNotMatch(
    multisig,
    /className="mt-0\.5 inline-block rounded-md bg-\[#30D158\]\/15/,
  );
});
