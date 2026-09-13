import {
  APPLICATION_VERSION,
  BRAND_NAME,
  BUILD_COMMIT,
  SOURCE_COMMIT_URL,
} from "@/lib/brand";

const SHORT_BUILD_COMMIT =
  BUILD_COMMIT === "development" ? BUILD_COMMIT : BUILD_COMMIT.slice(0, 7);
const HAS_SOURCE_COMMIT = /^[0-9a-f]{40}$/.test(BUILD_COMMIT);

export function BuildIdentity({ className = "" }: { className?: string }) {
  const content = <>v{APPLICATION_VERSION} · {SHORT_BUILD_COMMIT}</>;
  const title = `${BRAND_NAME} version ${APPLICATION_VERSION} · full build ${BUILD_COMMIT}`;
  const classes = `font-mono tabular-nums whitespace-nowrap ${className}`.trim();

  if (HAS_SOURCE_COMMIT) {
    return (
      <a
        data-build-identity
        className={classes}
        href={SOURCE_COMMIT_URL}
        title={title}
      >
        {content}
      </a>
    );
  }

  return (
    <span data-build-identity className={classes} title={title}>
      {content}
    </span>
  );
}
