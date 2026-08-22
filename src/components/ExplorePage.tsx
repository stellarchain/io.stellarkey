"use client";

import { useMemo, useState } from "react";
import { IconCompass, IconExternal, IconFlame, IconSearch, IconShield } from "./icons";
import { triggerHaptic } from "@/lib/haptics";

interface DApp {
  id: string;
  name: string;
  category: "defi" | "lending" | "ramps" | "bridges" | "tools";
  categoryLabel: string;
  description: string;
  url: string;
  iconBg: string;
  iconEmoji: string;
  isSoroban?: boolean;
  featured?: boolean;
  tvlOrVolume?: string;
}

const DAPPS: DApp[] = [
  {
    id: "soroswap",
    name: "Soroswap",
    category: "defi",
    categoryLabel: "DeFi & Swaps",
    description: "The primary Uniswap-style AMM DEX and liquidity protocol built natively on Soroban smart contracts.",
    url: "https://soroswap.finance",
    iconBg: "from-blue-600 to-indigo-600",
    iconEmoji: "⚡",
    isSoroban: true,
    featured: true,
    tvlOrVolume: "Top Soroban AMM",
  },
  {
    id: "blend",
    name: "Blend Protocol",
    category: "lending",
    categoryLabel: "Lending & Yield",
    description: "Decentralized, non-custodial liquidity market on Soroban. Supply assets to earn yield or borrow against collateral.",
    url: "https://blend.capital",
    iconBg: "from-emerald-500 to-teal-700",
    iconEmoji: "🏦",
    isSoroban: true,
    featured: true,
    tvlOrVolume: "Lending Market",
  },
  {
    id: "aquarius",
    name: "Aquarius AMM",
    category: "defi",
    categoryLabel: "DeFi & Swaps",
    description: "Liquidity reward layer and automated market maker for Stellar DEX pairs. Vote and earn AQUA rewards.",
    url: "https://aqua.network",
    iconBg: "from-cyan-500 to-blue-600",
    iconEmoji: "🌊",
    tvlOrVolume: "Liquidity Hub",
  },
  {
    id: "phoenix",
    name: "Phoenix DEX",
    category: "defi",
    categoryLabel: "DeFi & Swaps",
    description: "Ultra-fast, modular decentralized exchange and smart routing engine written entirely in Rust for Soroban.",
    url: "https://phoenix-dex.eth.limo",
    iconBg: "from-amber-500 to-orange-600",
    iconEmoji: "🔥",
    isSoroban: true,
  },
  {
    id: "moneygram",
    name: "MoneyGram Access",
    category: "ramps",
    categoryLabel: "On / Off Ramps",
    description: "Deposit and withdraw physical cash for USDC at hundreds of thousands of MoneyGram retail locations worldwide.",
    url: "https://www.moneygram.com/mgo/us/en/mgo-stellar",
    iconBg: "from-red-500 to-rose-700",
    iconEmoji: "💵",
    featured: true,
    tvlOrVolume: "Global Cash Ramps",
  },
  {
    id: "allbridge",
    name: "Allbridge Core",
    category: "bridges",
    categoryLabel: "Bridges",
    description: "Cross-chain liquidity bridge connecting Stellar & Soroban native USDC directly to Ethereum, Solana, and Arbitrum.",
    url: "https://core.allbridge.io",
    iconBg: "from-purple-500 to-indigo-700",
    iconEmoji: "🌉",
    isSoroban: true,
  },
  {
    id: "stellarx",
    name: "StellarX",
    category: "defi",
    categoryLabel: "DeFi & Swaps",
    description: "Professional trading terminal with live order books, limit orders, market depth, and zero protocol fees.",
    url: "https://www.stellarx.com",
    iconBg: "from-sky-500 to-blue-700",
    iconEmoji: "📈",
  },
  {
    id: "stellarexpert",
    name: "StellarExpert",
    category: "tools",
    categoryLabel: "Analytics & Tools",
    description: "Comprehensive Stellar blockchain analytics, ledger search, asset ratings, and Soroban contract inspector.",
    url: "https://stellar.expert",
    iconBg: "from-zinc-600 to-zinc-800",
    iconEmoji: "🔍",
  },
  {
    id: "vibrant",
    name: "Vibrant",
    category: "ramps",
    categoryLabel: "On / Off Ramps",
    description: "Inflation-protected digital savings and cross-border remittance app built on Stellar digital dollars.",
    url: "https://vibrantapp.com",
    iconBg: "from-teal-500 to-emerald-600",
    iconEmoji: "🛡️",
  },
  {
    id: "beans",
    name: "Beans App",
    category: "ramps",
    categoryLabel: "On / Off Ramps",
    description: "Instant cross-border, multi-currency peer-to-peer payments with automatic currency conversion via Stellar DEX.",
    url: "https://www.beansapp.com",
    iconBg: "from-green-500 to-lime-600",
    iconEmoji: "🌱",
  },
  {
    id: "trezor-suite",
    name: "Trezor Suite",
    category: "tools",
    categoryLabel: "Hardware & Tools",
    description: "Official desktop and web suite for Trezor hardware cold storage (Safe 3, Model T, Model One) on Stellar.",
    url: "https://suite.trezor.io",
    iconBg: "from-emerald-600 to-teal-800",
    iconEmoji: "🛡️",
    featured: true,
    tvlOrVolume: "Hardware Security",
  },
];

const CATEGORIES = [
  { id: "all", label: "All Ecosystem" },
  { id: "defi", label: "DeFi & Swaps" },
  { id: "lending", label: "Lending & Yield" },
  { id: "ramps", label: "Cash & Ramps" },
  { id: "bridges", label: "Bridges" },
  { id: "tools", label: "Tools" },
] as const;

export function ExplorePage() {
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const filteredDApps = useMemo(() => {
    return DAPPS.filter((app) => {
      const matchesCat = activeCategory === "all" || app.category === activeCategory;
      const matchesSearch =
        searchQuery === "" ||
        app.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        app.categoryLabel.toLowerCase().includes(searchQuery.toLowerCase());
      return matchesCat && matchesSearch;
    });
  }, [activeCategory, searchQuery]);

  const featuredDApps = useMemo(() => DAPPS.filter((d) => d.featured), []);

  return (
    <div className="space-y-6 pb-12 animate-fade-in">
      {/* Header Banner */}
      <div className="relative overflow-hidden rounded-3xl p-6 sm:p-8 bg-gradient-to-br from-indigo-950/40 via-zinc-900/60 to-black border border-white/[0.08] shadow-2xl backdrop-blur-2xl">
        <div className="absolute top-0 right-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-indigo-500/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/15 border border-indigo-500/30 text-xs font-semibold text-indigo-300 mb-3">
              <IconCompass size={14} />
              <span>Stellar & Soroban Ecosystem</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
              Explore dApps & Protocols
            </h1>
            <p className="text-sm text-zinc-400 mt-1 max-w-xl">
              Discover verified smart contracts, lending markets, cross-chain bridges, and zero-fee cash on/off ramps powered by Stellar.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <div className="px-3.5 py-2 rounded-2xl bg-white/[0.04] border border-white/[0.08] text-xs font-medium text-zinc-300 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span>Verified Protocols</span>
            </div>
          </div>
        </div>
      </div>

      {/* Featured Spotlight Grid */}
      {searchQuery === "" && activeCategory === "all" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <IconFlame size={14} className="text-amber-400" />
              Featured Spotlight
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {featuredDApps.map((app) => (
              <a
                key={app.id}
                href={app.url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={() => {
                  triggerHaptic("light");
                }}
                className="group relative flex flex-col justify-between p-5 rounded-2xl bg-zinc-900/50 hover:bg-zinc-800/60 border border-white/[0.06] hover:border-white/[0.14] transition-all duration-200 hover:-translate-y-0.5 shadow-lg backdrop-blur-xl"
              >
                <div>
                  <div className="flex items-center justify-between mb-3.5">
                    <div
                      className={`w-11 h-11 rounded-2xl bg-gradient-to-br ${app.iconBg} flex items-center justify-center text-xl shadow-md`}
                    >
                      {app.iconEmoji}
                    </div>
                    <div className="flex items-center gap-1.5">
                      {app.isSoroban && (
                        <span className="px-2 py-0.5 rounded-full bg-purple-500/20 border border-purple-500/30 text-[10px] font-semibold text-purple-300 tracking-wide">
                          Soroban
                        </span>
                      )}
                      <IconExternal
                        size={14}
                        className="text-zinc-500 group-hover:text-zinc-300 transition-colors ml-1"
                      />
                    </div>
                  </div>
                  <h3 className="font-semibold text-base text-zinc-100 group-hover:text-white transition-colors">
                    {app.name}
                  </h3>
                  <p className="text-xs text-zinc-400 line-clamp-2 mt-1 leading-relaxed">
                    {app.description}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-white/[0.04] flex items-center justify-between text-xs">
                  <span className="text-indigo-400 font-medium">{app.categoryLabel}</span>
                  {app.tvlOrVolume && (
                    <span className="text-zinc-500 text-[11px] font-mono">{app.tvlOrVolume}</span>
                  )}
                </div>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-2">
        {/* Category Pill Filters */}
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {CATEGORIES.map((cat) => {
            const isSelected = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => {
                  triggerHaptic("selection");
                  setActiveCategory(cat.id);
                }}
                className={`px-3.5 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-150 ${
                  isSelected
                    ? "bg-white text-black shadow-sm font-semibold"
                    : "bg-zinc-900/80 text-zinc-400 hover:text-zinc-200 border border-white/[0.06] hover:bg-zinc-800"
                }`}
              >
                {cat.label}
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="relative min-w-[220px]">
          <IconSearch
            size={14}
            className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
          />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search protocols..."
            className="w-full pl-9 pr-4 py-1.5 rounded-full bg-zinc-900/80 border border-white/[0.08] text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-indigo-500/50 focus:ring-1 focus:ring-indigo-500/30 transition-all"
          />
        </div>
      </div>

      {/* All dApps Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
        {filteredDApps.map((app) => (
          <a
            key={app.id}
            href={app.url}
            target="_blank"
            rel="noreferrer noopener"
            onClick={() => {
              
              triggerHaptic("light");
            }}
            className="group p-4 rounded-2xl bg-zinc-900/40 hover:bg-zinc-800/50 border border-white/[0.05] hover:border-white/[0.12] transition-all duration-200 hover:-translate-y-0.5 flex flex-col justify-between shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-xl bg-gradient-to-br ${app.iconBg} flex items-center justify-center text-lg shadow-sm`}
                  >
                    {app.iconEmoji}
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm text-zinc-100 group-hover:text-white transition-colors flex items-center gap-1.5">
                      {app.name}
                      <IconShield size={12} className="text-emerald-400" />
                    </h3>
                    <span className="text-[11px] text-zinc-500">{app.categoryLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {app.isSoroban && (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/15 text-[10px] font-medium text-purple-300 border border-purple-500/20">
                      Soroban
                    </span>
                  )}
                  <IconExternal
                    size={14}
                    className="text-zinc-600 group-hover:text-zinc-400 transition-colors"
                  />
                </div>
              </div>
              <p className="text-xs text-zinc-400 leading-relaxed">{app.description}</p>
            </div>
          </a>
        ))}
      </div>

      {filteredDApps.length === 0 && (
        <div className="text-center py-12 text-zinc-500 text-xs">
          No protocols or dApps found matching &quot;{searchQuery}&quot;.
        </div>
      )}
    </div>
  );
}
