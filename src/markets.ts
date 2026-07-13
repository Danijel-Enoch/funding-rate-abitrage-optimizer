/**
 * Market mapping: Hyperliquid perpetual coins → Binance USDT spot pairs
 * Only includes coins available on BOTH platforms
 */

export interface MarketConfig {
  hlCoin: string;        // Hyperliquid coin name
  binanceSymbol: string; // Binance USDT pair
  name: string;          // Human-readable name
  category: string;      // Category for filtering
}

export const MARKETS: MarketConfig[] = [
  // === Layer 1 ===
  { hlCoin: "BTC", binanceSymbol: "BTCUSDT", name: "Bitcoin", category: "L1" },
  { hlCoin: "ETH", binanceSymbol: "ETHUSDT", name: "Ethereum", category: "L1" },
  { hlCoin: "SOL", binanceSymbol: "SOLUSDT", name: "Solana", category: "L1" },
  { hlCoin: "BNB", binanceSymbol: "BNBUSDT", name: "BNB", category: "L1" },
  { hlCoin: "XRP", binanceSymbol: "XRPUSDT", name: "XRP", category: "L1" },
  { hlCoin: "ADA", binanceSymbol: "ADAUSDT", name: "Cardano", category: "L1" },
  { hlCoin: "DOGE", binanceSymbol: "DOGEUSDT", name: "Dogecoin", category: "L1" },
  { hlCoin: "AVAX", binanceSymbol: "AVAXUSDT", name: "Avalanche", category: "L1" },
  { hlCoin: "DOT", binanceSymbol: "DOTUSDT", name: "Polkadot", category: "L1" },
  { hlCoin: "LINK", binanceSymbol: "LINKUSDT", name: "Chainlink", category: "L1" },
  { hlCoin: "MATIC", binanceSymbol: "MATICUSDT", name: "Polygon", category: "L1" },
  { hlCoin: "ATOM", binanceSymbol: "ATOMUSDT", name: "Cosmos", category: "L1" },
  { hlCoin: "LTC", binanceSymbol: "LTCUSDT", name: "Litecoin", category: "L1" },
  { hlCoin: "NEAR", binanceSymbol: "NEARUSDT", name: "NEAR Protocol", category: "L1" },
  { hlCoin: "APT", binanceSymbol: "APTUSDT", name: "Aptos", category: "L1" },
  { hlCoin: "SUI", binanceSymbol: "SUIUSDT", name: "Sui", category: "L1" },
  { hlCoin: "SEI", binanceSymbol: "SEIUSDT", name: "Sei", category: "L1" },
  { hlCoin: "TON", binanceSymbol: "TONUSDT", name: "Toncoin", category: "L1" },
  { hlCoin: "TRX", binanceSymbol: "TRXUSDT", name: "TRON", category: "L1" },
  { hlCoin: "MINA", binanceSymbol: "MINAUSDT", name: "Mina Protocol", category: "L1" },
  { hlCoin: "HBAR", binanceSymbol: "HBARUSDT", name: "Hedera", category: "L1" },
  { hlCoin: "ALGO", binanceSymbol: "ALGOUSDT", name: "Algorand", category: "L1" },
  { hlCoin: "XLM", binanceSymbol: "XLMUSDT", name: "Stellar", category: "L1" },
  { hlCoin: "FIL", binanceSymbol: "FILUSDT", name: "Filecoin", category: "L1" },
  { hlCoin: "ICP", binanceSymbol: "ICPUSDT", name: "Internet Computer", category: "L1" },
  { hlCoin: "ETC", binanceSymbol: "ETCUSDT", name: "Ethereum Classic", category: "L1" },
  { hlCoin: "BCH", binanceSymbol: "BCHUSDT", name: "Bitcoin Cash", category: "L1" },
  { hlCoin: "CFX", binanceSymbol: "CFXUSDT", name: "Conflux", category: "L1" },
  { hlCoin: "FTM", binanceSymbol: "FTMUSDT", name: "Fantom", category: "L1" },
  { hlCoin: "XMR", binanceSymbol: "XMRUSDT", name: "Monero", category: "L1" },
  { hlCoin: "ZEC", binanceSymbol: "ZECUSDT", name: "Zcash", category: "L1" },
  { hlCoin: "DASH", binanceSymbol: "DASHUSDT", name: "Dash", category: "L1" },

  // === Layer 2 ===
  { hlCoin: "OP", binanceSymbol: "OPUSDT", name: "Optimism", category: "L2" },
  { hlCoin: "ARB", binanceSymbol: "ARBUSDT", name: "Arbitrum", category: "L2" },
  { hlCoin: "STX", binanceSymbol: "STXUSDT", name: "Stacks", category: "L2" },
  { hlCoin: "MNT", binanceSymbol: "MNTUSDT", name: "Mantle", category: "L2" },
  { hlCoin: "POL", binanceSymbol: "POLUSDT", name: "Polygon PoS", category: "L2" },
  { hlCoin: "STRK", binanceSymbol: "STRKUSDT", name: "Starknet", category: "L2" },
  { hlCoin: "ZK", binanceSymbol: "ZKUSDT", name: "zkSync", category: "L2" },
  { hlCoin: "BLAST", binanceSymbol: "BLASTUSDT", name: "Blast", category: "L2" },
  { hlCoin: "LINEA", binanceSymbol: "LINEAUSDT", name: "Linea", category: "L2" },

  // === DeFi ===
  { hlCoin: "UNI", binanceSymbol: "UNIUSDT", name: "Uniswap", category: "DeFi" },
  { hlCoin: "AAVE", binanceSymbol: "AAVEUSDT", name: "Aave", category: "DeFi" },
  { hlCoin: "MKR", binanceSymbol: "MKRUSDT", name: "Maker", category: "DeFi" },
  { hlCoin: "CRV", binanceSymbol: "CRVUSDT", name: "Curve", category: "DeFi" },
  { hlCoin: "SNX", binanceSymbol: "SNXUSDT", name: "Synthetix", category: "DeFi" },
  { hlCoin: "LDO", binanceSymbol: "LDOUSDT", name: "Lido", category: "DeFi" },
  { hlCoin: "COMP", binanceSymbol: "COMPUSDT", name: "Compound", category: "DeFi" },
  { hlCoin: "DYDX", binanceSymbol: "DYDXUSDT", name: "dYdX", category: "DeFi" },
  { hlCoin: "PENDLE", binanceSymbol: "PENDLEUSDT", name: "Pendle", category: "DeFi" },
  { hlCoin: "RUNE", binanceSymbol: "RUNEUSDT", name: "THORChain", category: "DeFi" },
  { hlCoin: "SUSHI", binanceSymbol: "SUSHIUSDT", name: "SushiSwap", category: "DeFi" },
  { hlCoin: "GMX", binanceSymbol: "GMXUSDT", name: "GMX", category: "DeFi" },
  { hlCoin: "ENA", binanceSymbol: "ENAUSDT", name: "Ethena", category: "DeFi" },
  { hlCoin: "ONDO", binanceSymbol: "ONDOUSDT", name: "Ondo Finance", category: "DeFi" },
  { hlCoin: "PAXG", binanceSymbol: "PAXGUSDT", name: "PAX Gold", category: "DeFi" },
  { hlCoin: "ENS", binanceSymbol: "ENSUSDT", name: "Ethereum Name Service", category: "DeFi" },
  { hlCoin: "WLD", binanceSymbol: "WLDUSDT", name: "Worldcoin", category: "DeFi" },
  { hlCoin: "ZRO", binanceSymbol: "ZROUSDT", name: "LayerZero", category: "DeFi" },
  { hlCoin: "JUP", binanceSymbol: "JUPUSDT", name: "Jupiter", category: "DeFi" },
  { hlCoin: "JTO", binanceSymbol: "JTOUSDT", name: "Jito", category: "DeFi" },
  { hlCoin: "PYTH", binanceSymbol: "PYTHUSDT", name: "Pyth Network", category: "DeFi" },
  { hlCoin: "CAKE", binanceSymbol: "CAKEUSDT", name: "PancakeSwap", category: "DeFi" },
  { hlCoin: "RSR", binanceSymbol: "RSRUSDT", name: "Reserve Rights", category: "DeFi" },
  { hlCoin: "UMA", binanceSymbol: "UMAUSDT", name: "UMA", category: "DeFi" },
  { hlCoin: "FXS", binanceSymbol: "FXSUSDT", name: "Frax Share", category: "DeFi" },
  { hlCoin: "BNT", binanceSymbol: "BNTUSDT", name: "Bancor", category: "DeFi" },
  { hlCoin: "ILV", binanceSymbol: "ILVUSDT", name: "Illuvium", category: "DeFi" },
  { hlCoin: "LPT", binanceSymbol: "LPTUSDT", name: "Livepeer", category: "DeFi" },
  { hlCoin: "MORPHO", binanceSymbol: "MORPHOUSDT", name: "Morpho", category: "DeFi" },
  { hlCoin: "USUAL", binanceSymbol: "USUALUSDT", name: "Usual", category: "DeFi" },
  { hlCoin: "MANTA", binanceSymbol: "MANTAUSDT", name: "Manta Network", category: "DeFi" },
  { hlCoin: "STRAX", binanceSymbol: "STRAXUSDT", name: "Stratis", category: "DeFi" },

  // === AI / Data ===
  { hlCoin: "FET", binanceSymbol: "FETUSDT", name: "Fetch.ai", category: "AI" },
  { hlCoin: "RENDER", binanceSymbol: "RENDERUSDT", name: "Render", category: "AI" },
  { hlCoin: "RNDR", binanceSymbol: "RNDRUSDT", name: "Render (old)", category: "AI" },
  { hlCoin: "TAO", binanceSymbol: "TAOUSDT", name: "Bittensor", category: "AI" },
  { hlCoin: "VIRTUAL", binanceSymbol: "VIRTUALUSDT", name: "Virtuals Protocol", category: "AI" },
  { hlCoin: "AI", binanceSymbol: "AIUSDT", name: "AI", category: "AI" },
  { hlCoin: "AIXBT", binanceSymbol: "AIXBTUSDT", name: "AI XBT", category: "AI" },
  { hlCoin: "GRASS", binanceSymbol: "GRASSUSDT", name: "Grass", category: "AI" },
  { hlCoin: "GOAT", binanceSymbol: "GOATUSDT", name: "Goatseus Maximus", category: "AI" },
  { hlCoin: "ZEREBRO", binanceSymbol: "ZEREBROUSDT", name: "Zerebro", category: "AI" },
  { hlCoin: "GRIFFAIN", binanceSymbol: "GRIFFAINUSDT", name: "Griffain", category: "AI" },
  { hlCoin: "AI16Z", binanceSymbol: "AI16ZUSDT", name: "ai16z", category: "AI" },
  { hlCoin: "KAITO", binanceSymbol: "KAITOUSDT", name: "Kaito", category: "AI" },

  // === Meme ===
  { hlCoin: "SHIB", binanceSymbol: "SHIBUSDT", name: "Shiba Inu", category: "Meme" },
  { hlCoin: "PEPE", binanceSymbol: "PEPEUSDT", name: "Pepe", category: "Meme" },
  { hlCoin: "WIF", binanceSymbol: "WIFUSDT", name: "dogwifhat", category: "Meme" },
  { hlCoin: "BONK", binanceSymbol: "BONKUSDT", name: "Bonk", category: "Meme" },
  { hlCoin: "FLOKI", binanceSymbol: "FLOKIUSDT", name: "Floki", category: "Meme" },
  { hlCoin: "BRETT", binanceSymbol: "BRETTUSDT", name: "Brett", category: "Meme" },
  { hlCoin: "POPCAT", binanceSymbol: "POPCATUSDT", name: "Popcat", category: "Meme" },
  { hlCoin: "MOODENG", binanceSymbol: "MOODENGUSDT", name: "Moo Deng", category: "Meme" },
  { hlCoin: "TURBO", binanceSymbol: "TURBOUSDT", name: "Turbo", category: "Meme" },
  { hlCoin: "NOT", binanceSymbol: "NOTUSDT", name: "Notcoin", category: "Meme" },
  { hlCoin: "PNUT", binanceSymbol: "PNUTUSDT", name: "Peanut the Squirrel", category: "Meme" },
  { hlCoin: "CATI", binanceSymbol: "CATIUSDT", name: "Catizen", category: "Meme" },
  { hlCoin: "DOGS", binanceSymbol: "DOGSUSDT", name: "Dogs", category: "Meme" },
  { hlCoin: "NEIRO", binanceSymbol: "NEIROUSDT", name: "Neiro", category: "Meme" },
  { hlCoin: "TRUMP", binanceSymbol: "TRUMPUSDT", name: "Official Trump", category: "Meme" },
  { hlCoin: "MELANIA", binanceSymbol: "MELANIAUSDT", name: "Melania Meme", category: "Meme" },
  { hlCoin: "CHILLGUY", binanceSymbol: "CHILLGUYUSDT", name: "Chill Guy", category: "Meme" },
  { hlCoin: "BOME", binanceSymbol: "BOMEUSDT", name: "BOOK OF MEME", category: "Meme" },
  { hlCoin: "SPX", binanceSymbol: "SPXUSDT", name: "SPX6900", category: "Meme" },
  { hlCoin: "MYRO", binanceSymbol: "MYROUSDT", name: "Myro", category: "Meme" },
  { hlCoin: "FARTCOIN", binanceSymbol: "FARTCOINUSDT", name: "Fartcoin", category: "Meme" },
  { hlCoin: "PENGU", binanceSymbol: "PENGUUSDT", name: "Pudgy Penguins", category: "Meme" },
  { hlCoin: "GALA", binanceSymbol: "GALAUSDT", name: "Gala", category: "Meme" },

  // === Infrastructure ===
  { hlCoin: "INJ", binanceSymbol: "INJUSDT", name: "Injective", category: "Infra" },
  { hlCoin: "TIA", binanceSymbol: "TIAUSDT", name: "Celestia", category: "Infra" },
  { hlCoin: "DYM", binanceSymbol: "DYMUSDT", name: "Dymension", category: "Infra" },
  { hlCoin: "SAGA", binanceSymbol: "SAGAUSDT", name: "Saga", category: "Infra" },
  { hlCoin: "NTRN", binanceSymbol: "NTRNUSDT", name: "Neutron", category: "Infra" },
  { hlCoin: "EIGEN", binanceSymbol: "EIGENUSDT", name: "EigenLayer", category: "Infra" },
  { hlCoin: "CELO", binanceSymbol: "CELOUSDT", name: "Celo", category: "Infra" },
  { hlCoin: "STG", binanceSymbol: "STGUSDT", name: "Stargate Finance", category: "Infra" },
  { hlCoin: "ZETA", binanceSymbol: "ZETAUSDT", name: "ZetaChain", category: "Infra" },
  { hlCoin: "W", binanceSymbol: "WUSDT", name: "Wormhole", category: "Infra" },
  { hlCoin: "ALT", binanceSymbol: "ALTUSDT", name: "AltLayer", category: "Infra" },
  { hlCoin: "PIXEL", binanceSymbol: "PIXELUSDT", name: "Pixels", category: "Infra" },
  { hlCoin: "TNSR", binanceSymbol: "TNSRUSDT", name: "Tensor", category: "Infra" },
  { hlCoin: "OMNI", binanceSymbol: "OMNIUSDT", name: "Omni Network", category: "Infra" },
  { hlCoin: "REZ", binanceSymbol: "REZUSDT", name: "Renzo", category: "Infra" },
  { hlCoin: "LISTA", binanceSymbol: "LISTAUSDT", name: "Lista DAO", category: "Infra" },
  { hlCoin: "IO", binanceSymbol: "IOUSDT", name: "io.net", category: "Infra" },
  { hlCoin: "ETHFI", binanceSymbol: "ETHFIUSDT", name: "ether.fi", category: "Infra" },
  { hlCoin: "MEW", binanceSymbol: "MEWUSDT", name: "cat in a dogs world", category: "Infra" },
  { hlCoin: "SCR", binanceSymbol: "SCRUSDT", name: "Scroll", category: "Infra" },
  { hlCoin: "HYPE", binanceSymbol: "HYPEUSDT", name: "Hyperliquid", category: "Infra" },
  { hlCoin: "MOVE", binanceSymbol: "MOVEUSDT", name: "Movement", category: "Infra" },
  { hlCoin: "BERA", binanceSymbol: "BERAUSDT", name: "Berachain", category: "Infra" },
  { hlCoin: "LAYER", binanceSymbol: "LAYERUSDT", name: "LAYER", category: "Infra" },
  { hlCoin: "IP", binanceSymbol: "IPUSDT", name: "Story", category: "Infra" },
  { hlCoin: "INIT", binanceSymbol: "INITUSDT", name: "Initia", category: "Infra" },
  { hlCoin: "HYPER", binanceSymbol: "HYPERUSDT", name: "Hyperlane", category: "Infra" },
  { hlCoin: "NIL", binanceSymbol: "NILUSDT", name: "Nil Foundation", category: "Infra" },
  { hlCoin: "SOPH", binanceSymbol: "SOPHUSDT", name: "Sophon", category: "Infra" },
  { hlCoin: "RESOLV", binanceSymbol: "RESOLVUSDT", name: "Resolv", category: "Infra" },
  { hlCoin: "HEMI", binanceSymbol: "HEMIUSDT", name: "Hemi Labs", category: "Infra" },
  { hlCoin: "WCT", binanceSymbol: "WCTUSDT", name: "Wormhole Connect", category: "Infra" },
  { hlCoin: "VANA", binanceSymbol: "VANAUSDT", name: "Vana", category: "Infra" },
  { hlCoin: "ME", binanceSymbol: "MEUSDT", name: "Magic Eden", category: "Infra" },
  { hlCoin: "PROMPT", binanceSymbol: "PROMPTUSDT", name: "Prompt", category: "Infra" },
  { hlCoin: "ZORA", binanceSymbol: "ZORAUSDT", name: "Zora", category: "Infra" },
  { hlCoin: "AERO", binanceSymbol: "AEROUSDT", name: "Aerodrome Finance", category: "Infra" },
  { hlCoin: "VELODROME", binanceSymbol: "VELODROMEUSDT", name: "Velodrome", category: "Infra" },

  // === Gaming / NFT / Metaverse ===
  { hlCoin: "AXS", binanceSymbol: "AXSUSDT", name: "Axie Infinity", category: "Gaming" },
  { hlCoin: "SAND", binanceSymbol: "SANDUSDT", name: "The Sandbox", category: "Gaming" },
  { hlCoin: "IMX", binanceSymbol: "IMXUSDT", name: "Immutable", category: "Gaming" },
  { hlCoin: "SUPER", binanceSymbol: "SUPERUSDT", name: "SuperVerse", category: "Gaming" },
  { hlCoin: "YGG", binanceSymbol: "YGGUSDT", name: "Yield Guild Games", category: "Gaming" },
  { hlCoin: "BEAM", binanceSymbol: "BEAMUSDT", name: "Beam", category: "Gaming" },
  { hlCoin: "BIGTIME", binanceSymbol: "BIGTIMEUSDT", name: "Big Time", category: "Gaming" },
  { hlCoin: "T", binanceSymbol: "TUSDT", name: "Threshold", category: "Gaming" },

  // === Oracle / Data ===
  { hlCoin: "BAND", binanceSymbol: "BANDUSDT", name: "Band Protocol", category: "Oracle" },
  { hlCoin: "API3", binanceSymbol: "API3USDT", name: "API3", category: "Oracle" },
  { hlCoin: "DIA", binanceSymbol: "DIAUSDT", name: "DIA", category: "Oracle" },

  // === Storage ===
  { hlCoin: "STORJ", binanceSymbol: "STORJUSDT", name: "Storj", category: "Storage" },
  { hlCoin: "AR", binanceSymbol: "ARUSDT", name: "Arweave", category: "Storage" },

  // === Social / Identity ===
  { hlCoin: "MASK", binanceSymbol: "MASKUSDT", name: "Mask Network", category: "Social" },
  { hlCoin: "GAL", binanceSymbol: "GALUSDT", name: "Galxe", category: "Social" },

  // === Privacy ===
  { hlCoin: "SCRT", binanceSymbol: "SCRTUSDT", name: "Secret Network", category: "Privacy" },

  // === Others ===
  { hlCoin: "THETA", binanceSymbol: "THETAUSDT", name: "Theta Network", category: "Other" },
  { hlCoin: "VET", binanceSymbol: "VETUSDT", name: "VeChain", category: "Other" },
  { hlCoin: "KAVA", binanceSymbol: "KAVAUSDT", name: "Kava", category: "Other" },
  { hlCoin: "WAVES", binanceSymbol: "WAVESUSDT", name: "Waves", category: "Other" },
  { hlCoin: "ENS", binanceSymbol: "ENSUSDT", name: "ENS", category: "Other" },
  { hlCoin: "OG", binanceSymbol: "OGUSDT", name: "OG Fan Token", category: "Other" },
  { hlCoin: "REQ", binanceSymbol: "REQUSDT", name: "Request Network", category: "Other" },
  { hlCoin: "KNC", binanceSymbol: "KNCUSDT", name: "Kyber Network", category: "Other" },
  { hlCoin: "ONE", binanceSymbol: "ONEUSDT", name: "Harmony", category: "Other" },
  { hlCoin: "OM", binanceSymbol: "OMUSDT", name: "Mantra", category: "Other" },
  { hlCoin: "POLYX", binanceSymbol: "POLYXUSDT", name: "Polymesh", category: "Other" },
  { hlCoin: "GAS", binanceSymbol: "GASUSDT", name: "NeoGas", category: "Other" },
  { hlCoin: "FIO", binanceSymbol: "FIOUSDT", name: "FIO Protocol", category: "Other" },
  { hlCoin: "CELR", binanceSymbol: "CELRUSDT", name: "Celer Network", category: "Other" },
  { hlCoin: "OGN", binanceSymbol: "OGNUSDT", name: "Origin Protocol", category: "Other" },
  { hlCoin: "NKN", binanceSymbol: "NKNUSDT", name: "NKN", category: "Other" },
  { hlCoin: "SKL", binanceSymbol: "SKLUSDT", name: "SKALE Network", category: "Other" },
  { hlCoin: "CTSI", binanceSymbol: "CTSIUSDT", name: "Cartesi", category: "Other" },
  { hlCoin: "LOOM", binanceSymbol: "LOOMUSDT", name: "Loom Network", category: "Other" },
  { hlCoin: "ARK", binanceSymbol: "ARKUSDT", name: "Ark", category: "Other" },
  { hlCoin: "RDNT", binanceSymbol: "RDNTUSDT", name: "Radiant Capital", category: "Other" },
  { hlCoin: "BLZ", binanceSymbol: "BLZUSDT", name: "Bluzelle", category: "Other" },
  { hlCoin: "CANTO", binanceSymbol: "CANTOUSDT", name: "Canto", category: "Other" },
  { hlCoin: "TRB", binanceSymbol: "TRBUSDT", name: "Tellor Tributes", category: "Other" },
  { hlCoin: "FTT", binanceSymbol: "FTTUSDT", name: "FTX Token", category: "Other" },
  { hlCoin: "BAL", binanceSymbol: "BALUSDT", name: "Balancer", category: "Other" },
  { hlCoin: "CVC", binanceSymbol: "CVCUSDT", name: "Civic", category: "Other" },
  { hlCoin: "NMR", binanceSymbol: "NMRUSDT", name: "Numeraire", category: "Other" },
  { hlCoin: "PERP", binanceSymbol: "PERPUSDT", name: "Perpetual Protocol", category: "Other" },
  { hlCoin: "POLS", binanceSymbol: "POLSUSDT", name: "Polkastarter", category: "Other" },
  { hlCoin: "PNT", binanceSymbol: "PNTUSDT", name: "pNetwork", category: "Other" },
  { hlCoin: "REN", binanceSymbol: "RENUSDT", name: "Ren", category: "Other" },
  { hlCoin: "SRM", binanceSymbol: "SRMUSDT", name: "Serum", category: "Other" },
  { hlCoin: "TOMO", binanceSymbol: "TOMOUSDT", name: "Tomochain", category: "Other" },
  { hlCoin: "VIB", binanceSymbol: "VIBUSDT", name: "Viberate", category: "Other" },
  { hlCoin: "VTHO", binanceSymbol: "VTHOUSDT", name: "VeThor Token", category: "Other" },
  { hlCoin: "WRX", binanceSymbol: "WRXUSDT", name: "WazirX", category: "Other" },
  { hlCoin: "ZIL", binanceSymbol: "ZILUSDT", name: "Zilliqa", category: "Other" },
];

/**
 * Get unique categories
 */
export function getCategories(): string[] {
  return [...new Set(MARKETS.map((m) => m.category))].sort();
}

/**
 * Get markets by category
 */
export function getMarketsByCategory(category: string): MarketConfig[] {
  return MARKETS.filter((m) => m.category === category);
}

/**
 * Search markets by name or symbol
 */
export function searchMarkets(query: string): MarketConfig[] {
  const q = query.toLowerCase();
  return MARKETS.filter(
    (m) =>
      m.hlCoin.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.binanceSymbol.toLowerCase().includes(q)
  );
}

// === Stocks, Commodities, ETFs (available on Paradex and/or Nado) ===

export const TRADITIONAL_MARKETS: MarketConfig[] = [
  // === Stocks ===
  { hlCoin: "AAPL", binanceSymbol: "AAPL", name: "Apple Inc.", category: "Stocks" },
  { hlCoin: "GOOGL", binanceSymbol: "GOOGL", name: "Alphabet (Google)", category: "Stocks" },
  { hlCoin: "AMZN", binanceSymbol: "AMZN", name: "Amazon", category: "Stocks" },
  { hlCoin: "META", binanceSymbol: "META", name: "Meta Platforms", category: "Stocks" },
  { hlCoin: "MSFT", binanceSymbol: "MSFT", name: "Microsoft", category: "Stocks" },
  { hlCoin: "NVDA", binanceSymbol: "NVDA", name: "NVIDIA", category: "Stocks" },
  { hlCoin: "TSLA", binanceSymbol: "TSLA", name: "Tesla", category: "Stocks" },
  { hlCoin: "AMD", binanceSymbol: "AMD", name: "AMD", category: "Stocks" },
  { hlCoin: "NFLX", binanceSymbol: "NFLX", name: "Netflix", category: "Stocks" },
  { hlCoin: "COIN", binanceSymbol: "COIN", name: "Coinbase", category: "Stocks" },
  { hlCoin: "PLTR", binanceSymbol: "PLTR", name: "Palantir", category: "Stocks" },
  { hlCoin: "HOOD", binanceSymbol: "HOOD", name: "Robinhood", category: "Stocks" },
  { hlCoin: "MSTR", binanceSymbol: "MSTR", name: "MicroStrategy", category: "Stocks" },
  { hlCoin: "ARM", binanceSymbol: "ARM", name: "ARM Holdings", category: "Stocks" },
  { hlCoin: "SMCI", binanceSymbol: "SMCI", name: "Super Micro", category: "Stocks" },
  { hlCoin: "MU", binanceSymbol: "MU", name: "Micron", category: "Stocks" },
  { hlCoin: "AVGO", binanceSymbol: "AVGO", name: "Broadcom", category: "Stocks" },
  { hlCoin: "ORCL", binanceSymbol: "ORCL", name: "Oracle", category: "Stocks" },
  { hlCoin: "INTC", binanceSymbol: "INTC", name: "Intel", category: "Stocks" },
  { hlCoin: "BABA", binanceSymbol: "BABA", name: "Alibaba", category: "Stocks" },
  { hlCoin: "PYPL", binanceSymbol: "PYPL", name: "PayPal", category: "Stocks" },
  { hlCoin: "SQ", binanceSymbol: "SQ", name: "Block (Square)", category: "Stocks" },
  { hlCoin: "SNOW", binanceSymbol: "SNOW", name: "Snowflake", category: "Stocks" },
  { hlCoin: "CRWD", binanceSymbol: "CRWD", name: "CrowdStrike", category: "Stocks" },
  { hlCoin: "NET", binanceSymbol: "NET", name: "Cloudflare", category: "Stocks" },
  { hlCoin: "DDOG", binanceSymbol: "DDOG", name: "Datadog", category: "Stocks" },
  { hlCoin: "ZS", binanceSymbol: "ZS", name: "Zscaler", category: "Stocks" },
  { hlCoin: "MDB", binanceSymbol: "MDB", name: "MongoDB", category: "Stocks" },
  { hlCoin: "SNAP", binanceSymbol: "SNAP", name: "Snap Inc.", category: "Stocks" },
  { hlCoin: "UBER", binanceSymbol: "UBER", name: "Uber", category: "Stocks" },
  { hlCoin: "ABNB", binanceSymbol: "ABNB", name: "Airbnb", category: "Stocks" },
  { hlCoin: "SHOP", binanceSymbol: "SHOP", name: "Shopify", category: "Stocks" },

  // === Commodities ===
  { hlCoin: "XAU", binanceSymbol: "XAU", name: "Gold", category: "Commodities" },
  { hlCoin: "XAG", binanceSymbol: "XAG", name: "Silver", category: "Commodities" },
  { hlCoin: "WTI", binanceSymbol: "WTI", name: "Crude Oil (WTI)", category: "Commodities" },
  { hlCoin: "BRENT", binanceSymbol: "BRENT", name: "Brent Crude", category: "Commodities" },
  { hlCoin: "NATGAS", binanceSymbol: "NATGAS", name: "Natural Gas", category: "Commodities" },
  { hlCoin: "COPPER", binanceSymbol: "COPPER", name: "Copper", category: "Commodities" },
  { hlCoin: "PALLADIUM", binanceSymbol: "PALLADIUM", name: "Palladium", category: "Commodities" },
  { hlCoin: "PLATINUM", binanceSymbol: "PLATINUM", name: "Platinum", category: "Commodities" },

  // === ETFs ===
  { hlCoin: "SPY", binanceSymbol: "SPY", name: "S&P 500 ETF", category: "ETFs" },
  { hlCoin: "QQQ", binanceSymbol: "QQQ", name: "Nasdaq 100 ETF", category: "ETFs" },
  { hlCoin: "IWM", binanceSymbol: "IWM", name: "Russell 2000 ETF", category: "ETFs" },
  { hlCoin: "GLD", binanceSymbol: "GLD", name: "Gold ETF", category: "ETFs" },
  { hlCoin: "SLV", binanceSymbol: "SLV", name: "Silver ETF", category: "ETFs" },
  { hlCoin: "USO", binanceSymbol: "USO", name: "Oil ETF", category: "ETFs" },
  { hlCoin: "XLF", binanceSymbol: "XLF", name: "Financial ETF", category: "ETFs" },
  { hlCoin: "XLK", binanceSymbol: "XLK", name: "Technology ETF", category: "ETFs" },
  { hlCoin: "ARKK", binanceSymbol: "ARKK", name: "ARK Innovation ETF", category: "ETFs" },
  { hlCoin: "SOXX", binanceSymbol: "SOXX", name: "Semiconductor ETF", category: "ETFs" },
];
