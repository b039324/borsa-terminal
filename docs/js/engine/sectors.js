// BIST 100 hisseleri için genel sektör sınıflaması (bist-terminal/mobil ile aynı). Listede olmayan: "Diğer".
export const SECTOR_LISTS = {
  'Bankacılık': ['AKBNK', 'ALBRK', 'GARAN', 'HALKB', 'ISCTR', 'TSKB', 'VAKBN', 'YKBNK'],
  'Sigorta/Finans': ['ANSGR', 'ANHYT', 'TURSG', 'ISMEN'],
  'Holding': ['AGHOL', 'ALARK', 'BERA', 'BINHO', 'BRYAT', 'DOHOL', 'ECZYT', 'GLYHO', 'KCHOL', 'PAHOL', 'SAHOL', 'TKFEN'],
  'Otomotiv': ['DOAS', 'EGEEN', 'FROTO', 'KARSN', 'OTKAR', 'TOASO', 'TTRAK'],
  'Enerji': ['AKFYE', 'AKSEN', 'AYGAZ', 'CANTE', 'CWENE', 'ENERY', 'ENJSA', 'ENTRA', 'EUREN', 'GWIND', 'ODAS', 'TRENJ', 'TUPRS', 'ZOREN'],
  'Kimya': ['AKSA', 'EGGUB', 'GUBRF', 'HEKTS', 'PETKM', 'SASA'],
  'Metal': ['BRSAN', 'CVKMD', 'EREGL', 'ISDMR', 'KCAER', 'KRDMD'],
  'Madencilik': ['TRALT', 'TRMET'],
  'Sanayi': ['ARCLK', 'ASTOR', 'KATMR', 'KORDS', 'VESTL'],
  'Savunma': ['ASELS'],
  'Perakende': ['BIMAS', 'MAVI', 'MGROS', 'SOKM'],
  'Gıda/İçecek': ['AEFES', 'CCOLA', 'OBAMS', 'TABGD', 'TUKAS', 'ULKER'],
  'Ulaştırma': ['GRSEL', 'PGSUS', 'RYSAS', 'TAVHL', 'THYAO'],
  'İletişim': ['TCELL', 'TTKOM'],
  'GYO': ['EKGYO', 'RGYAS', 'SNGYO', 'TRGYO'],
  'İnşaat': ['ENKAI', 'GLRMK'],
  'Çimento/Cam': ['AKCNS', 'BTCIM', 'CIMSA', 'LMKDC', 'OYAKC', 'SISE'],
  'Sağlık': ['ECILC', 'MPARK'],
};

const OF = {};
for (const [k, arr] of Object.entries(SECTOR_LISTS)) for (const s of arr) OF[s] = k;

/** "THYAO" veya "THYAO.IS" → sektör adı */
export const sectorOf = (sym) => OF[String(sym).replace(/\.IS$/, '')] || 'Diğer';
