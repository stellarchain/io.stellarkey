"use client";

import { decodeContactAddress, type ContactChannel } from "@/lib/brand";

export function ContactAction({
  channel,
  children,
}: {
  channel: ContactChannel;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="btn btn-ghost min-h-11"
      onClick={() => {
        window.location.href = `mailto:${decodeContactAddress(channel)}`;
      }}
    >
      {children}
    </button>
  );
}
