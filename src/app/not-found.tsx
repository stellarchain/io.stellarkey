import type { Metadata } from "next";
import { PublicFooter } from "@/components/PublicFooter";
import { BuildIdentity } from "@/components/BuildIdentity";
import { LogoMark } from "@/components/icons";
import { BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";

export const metadata: Metadata = {
  title: "Page not found",
  description: `The requested page is not part of this ${BRAND_NAME} release.`,
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <div className="app-safe-top flex min-h-screen flex-col">
      <main id="app-content" className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <LogoMark size={56} />
        <p className="eyebrow mt-7">404 · {BRAND_NAME}</p>
        <BuildIdentity className="mt-3 text-[10px] text-neutral-500 transition-colors hover:text-neutral-300" />
        <h1 className="display-h mt-3 text-[34px] text-white">Page not found</h1>
        <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-neutral-400">
          This address is not part of the current StellarKey release. Your local vault has not been
          changed.
        </p>
        <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
          <a className="btn btn-primary min-h-11" href={PUBLIC_ROUTES.home}>
            Back to the home page
          </a>
          <a className="btn btn-ghost min-h-11" href={PUBLIC_ROUTES.app}>
            Open the wallet
          </a>
        </div>
      </main>
      <PublicFooter compact showBuildIdentity={false} />
    </div>
  );
}
