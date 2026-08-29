import {
  createAccountMark,
  createAccountMarkTint,
} from "@/lib/account-mark";

/**
 * The account's identity mark, derived only from its public key.
 *
 * Ground and cells are struck from one hue so the tile reads as a single
 * object at a glance, and unset cells stay faintly visible: the grid itself
 * is what holds the shape together once the mark is small enough that
 * individual cells stop resolving.
 */
export function AccountMark({
  publicKey,
  size = 32,
}: {
  publicKey: string;
  size?: number;
}) {
  const cells = createAccountMark(publicKey);
  const { hue } = createAccountMarkTint(publicKey);

  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 grid-cols-5 gap-px rounded-[32%] shadow-inner"
      style={{
        width: size,
        height: size,
        padding: Math.max(2, Math.round(size * 0.14)),
        background: `hsl(${hue} 32% 15%)`,
        boxShadow: `inset 0 0 0 1px hsl(${hue} 45% 26%)`,
        color: `hsl(${hue} 80% 66%)`,
      }}
    >
      {cells.map((filled, index) => (
        <span
          key={index}
          className="aspect-square rounded-[20%] bg-current"
          style={{ opacity: filled ? 1 : 0.09 }}
        />
      ))}
    </span>
  );
}
