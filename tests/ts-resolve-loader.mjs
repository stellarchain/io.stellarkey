/** Resolve the extensionless local TypeScript imports used by Next.js in Node tests. */
export async function resolve(specifier, context, nextResolve) {
  let candidate = specifier;
  if (specifier.startsWith("@/")) {
    candidate = new URL(`../src/${specifier.slice(2)}`, import.meta.url).href;
  }

  try {
    return await nextResolve(candidate, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND") throw error;
    if (
      !candidate.startsWith("./") &&
      !candidate.startsWith("../") &&
      !candidate.startsWith("file:")
    ) {
      throw error;
    }

    const base = candidate.startsWith("file:")
      ? candidate
      : new URL(candidate, context.parentURL).href;
    for (const extension of [".ts", ".tsx"]) {
      try {
        return await nextResolve(`${base}${extension}`, context);
      } catch (nextError) {
        if (nextError?.code !== "ERR_MODULE_NOT_FOUND") throw nextError;
      }
    }
    throw error;
  }
}
