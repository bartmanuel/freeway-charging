/**
 * Brand colours and display labels for motorway amenity brands.
 * Used to render harmonised pill buttons in the station list and info card.
 */

export interface BrandConfig {
  label: string;
  bg: string;
  fg: string;
}

export const BRAND_CONFIGS: Record<string, BrandConfig> = {
  starbucks:    { label: 'Starbucks',        bg: '#00704A', fg: '#fff' },
  mcdonalds:    { label: "McDonald's",        bg: '#DA020E', fg: '#FFC72C' },
  burger_king:  { label: 'Burger King',       bg: '#F5821E', fg: '#fff' },
  kfc:          { label: 'KFC',               bg: '#E4002B', fg: '#fff' },
  autogrill:    { label: 'Autogrill',         bg: '#003DA5', fg: '#fff' },
  paul:         { label: 'PAUL',              bg: '#1C1C1C', fg: '#D4AC6E' },
  bonjour:      { label: 'Bonjour',           bg: '#C8102E', fg: '#fff' },
  serways:      { label: 'Serways',           bg: '#003087', fg: '#FFD700' },
  sanifair:     { label: 'Sanifair',          bg: '#0066B3', fg: '#fff' },
  '2theloo':    { label: '2theLoo',           bg: '#7DC400', fg: '#fff' },
  carrefour:    { label: 'Carrefour Express', bg: '#0061A0', fg: '#fff' },
  larche:       { label: "L'Arche",           bg: '#8B1A1A', fg: '#fff' },
  shell:        { label: 'Shell',             bg: '#FFC000', fg: '#E31836' },
};

/** Returns the BrandConfig for a normalised brand key, or null if unknown. */
export function getBrandConfig(brand: string): BrandConfig | null {
  return BRAND_CONFIGS[brand] ?? null;
}

/** Normalises a raw place name to one of the known brand keys, or null. */
export function normaliseBrand(name: string): string | null {
  const s = name.toLowerCase();
  if (s.includes('starbucks')) return 'starbucks';
  if (s.includes("mcdonald") || s.includes("mc donald")) return 'mcdonalds';
  if (s.includes('burger king')) return 'burger_king';
  if (/\bkfc\b/.test(s) || s.includes('kentucky fried')) return 'kfc';
  if (s.includes('autogrill')) return 'autogrill';
  if (/\bpaul\b/.test(s)) return 'paul';
  if (s.includes('bonjour')) return 'bonjour';
  if (s.includes('serways')) return 'serways';
  if (s.includes('sanifair')) return 'sanifair';
  if (s.includes('2theloo') || s.includes('2thloo') || s.includes('2 the loo')) return '2theloo';
  if (s.includes('carrefour')) return 'carrefour';
  if (s.includes('arche')) return 'larche';
  if (s.includes('shell')) return 'shell';
  return null;
}
