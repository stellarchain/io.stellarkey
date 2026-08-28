import Link from "next/link";
import {
  BRAND_NAME,
  COPYRIGHT_OWNER,
  COPYRIGHT_YEAR,
  PUBLIC_ROUTES,
  SOURCE_REPOSITORY_URL,
} from "@/lib/brand";
import { LogoMark } from "@/components/icons";
import {
  DocAlert,
  DocArrowOut,
  DocBook,
  DocChip,
  DocCoin,
  DocCompass,
  DocEyeOff,
  DocFile,
  DocKey,
  DocLock,
  DocQuestion,
  DocScales,
  DocShield,
} from "./DocIcons";
import "./chrome.css";

/*
 * Header and footer for the marketing surfaces. The landing sections are
 * generated markup, but the chrome carries real routes, so it is written by
 * hand: in-page anchors are absolute (`/#wallet`) so the same footer works
 * from the legal pages, where there is nothing on the page to scroll to.
 */

const NAV = [
  ["/#wallet", "Wallet"],
  ["/#till", "Till"],
  ["/#cost", "Cost"],
  ["/#limits", "Limits"],
  ["/#faq", "FAQ"],
] as const;

const PRODUCT = [
  ["/#wallet", "The wallet", DocLock],
  ["/#sale", "Taking a sale", DocKey],
  ["/#till", "Records", DocFile],
  ["/#cost", "What it costs", DocCoin],
  ["/#limits", "Limits", DocAlert],
  ["/#faq", "Questions", DocQuestion],
] as const;

/* The same marks the trust-centre tabs use, so the two agree on sight. */
const COMPANY = [
  [PUBLIC_ROUTES.about, "About", DocCompass],
  [PUBLIC_ROUTES.security, "Security", DocShield],
  [PUBLIC_ROUTES.support, "Support", DocBook],
  [PUBLIC_ROUTES.privacy, "Privacy", DocEyeOff],
  [PUBLIC_ROUTES.terms, "Terms", DocScales],
] as const;

/** The mark and the name; .brand on the parent lays the two out. */
function Brand() {
  return <><LogoMark className="glyph" />{BRAND_NAME}</>;
}

export function MarketingHeader() {
  return (
    <header>
      <nav className="nav">
        <Link className="brand" href={PUBLIC_ROUTES.home} aria-label={`${BRAND_NAME} home`}>
          <Brand />
        </Link>
        <div className="links">
          {NAV.map(([href, label]) => (
            <a key={href} href={href}>{label}</a>
          ))}
        </div>
        <Link className="btn btn-gold btn-sm" href={PUBLIC_ROUTES.app}>Open the app</Link>
      </nav>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer>
      <div className="foot">
        <div>
          <div className="brand"><Brand /></div>
          <p>
            A self-custody Stellar wallet with a point of sale in it. Runs as a static site with
            no backend; every screenshot on this page is the real app.
          </p>
        </div>
        <div>
          <h4>Product</h4>
          <ul>
            {PRODUCT.map(([href, label, Icon]) => (
              <li key={href}>
                <a href={href}><Icon />{label}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Company</h4>
          <ul>
            {COMPANY.map(([href, label, Icon]) => (
              <li key={href}>
                <Link href={href}><Icon />{label}</Link>
              </li>
            ))}
            <li>
              <a href={SOURCE_REPOSITORY_URL} target="_blank" rel="noopener noreferrer">
                <DocChip />Source
                <span className="out" aria-hidden="true"><DocArrowOut /></span>
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </li>
          </ul>
        </div>
      </div>
      <div className="legal">
        <span>© {COPYRIGHT_YEAR} {COPYRIGHT_OWNER} · self-custody · you hold the keys</span>
        <span className="fine">
          Independent project. Not affiliated with, sponsored or endorsed by the Stellar
          Development Foundation. “Stellar” is a trademark of the Stellar Development Foundation.
        </span>
      </div>
    </footer>
  );
}
