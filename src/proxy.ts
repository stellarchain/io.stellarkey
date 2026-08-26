import { type NextRequest, NextResponse } from "next/server";
import {
  buildSecurityPolicy,
  createCspNonce,
  getExternalRequestUrl,
  isPotentiallyTrustworthyUrl,
} from "@/lib/security-policy";

export function proxy(request: NextRequest) {
  const nonce = createCspNonce();
  const externalUrl = getExternalRequestUrl(
    request.nextUrl,
    request.headers.get("host"),
    request.headers.get("x-forwarded-proto"),
  );
  const secureRequest = externalUrl.protocol === "https:";
  const trustworthyRequest = isPotentiallyTrustworthyUrl(externalUrl);
  const policy = buildSecurityPolicy({
    nonce,
    development: process.env.NODE_ENV === "development",
    secureRequest,
  });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()",
  );
  if (trustworthyRequest) {
    response.headers.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  }
  return response;
}

export const config = {
  matcher: [
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|sw.js|icon.svg|icon-192.png|icon-512.png|apple-touch-icon.png|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
