import { PublicFooter } from "@/components/PublicFooter";
import { LogoMark } from "@/components/icons";
import { BRAND_NAME, PUBLIC_ROUTES } from "@/lib/brand";

export default function NotFound() {
  return (
    <div className="app-safe-top flex min-h-screen flex-col">
      <main id="app-content" className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <LogoMark size={56} />
        <p className="eyebrow mt-7">404 · {BRAND_NAME}</p>
        <h1 className="display-h mt-3 text-[34px] text-white">Page not found</h1>
        <p className="mt-4 max-w-sm text-[14px] leading-relaxed text-neutral-400">
          This address is not part of the current StellarKey release. Your local vault has not been
          changed.
        </p>
        <a className="btn btn-primary mt-7 min-h-11" href={PUBLIC_ROUTES.home}>
          Return to StellarKey
        </a>
      </main>
      <PublicFooter compact />
    </div>
  );
}
