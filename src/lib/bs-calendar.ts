/**
 * bs-calendar.ts
 * Bikram Sambat (Nepali) <-> English date engine.
 * Direct TypeScript port of CalendarUtil.gs — pure math, zero server calls.
 * Same anchor-counting method as the original Delphi TSysDate unit.
 */

// ── Data ──────────────────────────────────────────────────────────────────────
// Format: 'YYYY,DD/MM/YYYY,M1,M2,...,M12'
//   YYYY        = BS year
//   DD/MM/YYYY  = English date of Baisakh 1 (anchor)
//   M1..M12     = days in each month

const BS_RAW = [
  '1990,13/04/1933,31,31,32,31,31,31,30,29,30,29,30,30',
  '1991,13/04/1934,31,32,31,32,31,30,30,29,30,29,30,30',
  '1992,13/04/1935,31,32,31,32,31,30,30,30,29,30,29,31',
  '1993,13/04/1936,31,31,31,32,31,31,30,29,30,29,30,30',
  '1994,13/04/1937,31,31,32,31,31,31,30,29,30,29,30,30',
  '1995,13/04/1938,31,32,31,32,31,30,30,30,29,29,30,30',
  '1996,13/04/1939,31,32,31,32,31,30,30,30,29,30,29,31',
  '1997,13/04/1940,31,31,32,31,31,31,30,29,30,29,30,30',
  '1998,13/04/1941,31,31,32,31,31,31,30,29,30,29,30,30',
  '1999,13/04/1942,31,32,31,32,31,30,30,30,29,29,30,31',
  '2000,13/04/1943,30,32,31,32,31,30,30,30,29,30,29,31',
  '2001,13/04/1944,31,31,31,31,31,31,30,29,30,29,30,30',
  '2002,13/04/1945,31,31,32,32,31,30,30,29,30,29,30,30',
  '2003,13/04/1946,31,32,31,32,31,30,30,30,29,29,30,31',
  '2004,14/04/1947,30,32,31,32,31,30,30,30,29,30,29,31',
  '2005,13/04/1948,31,31,32,31,31,31,30,29,30,29,30,30',
  '2006,13/04/1949,31,31,32,32,31,30,30,29,30,29,30,30',
  '2007,13/04/1950,31,32,31,32,31,30,30,30,29,29,30,31',
  '2008,14/04/1951,31,31,31,32,31,31,30,30,30,29,29,31',
  '2009,13/04/1952,31,31,32,31,31,31,30,29,30,29,30,30',
  '2010,13/04/1953,31,31,32,32,31,30,30,29,30,29,30,30',
  '2011,13/04/1954,31,32,31,32,31,30,30,30,29,29,30,31',
  '2012,14/04/1955,31,31,31,32,31,31,29,30,30,29,30,30',
  '2013,13/04/1956,31,31,32,31,31,31,30,29,30,29,30,30',
  '2014,13/04/1957,31,31,32,32,31,30,30,29,30,29,30,30',
  '2015,13/04/1958,31,32,31,32,31,30,30,30,29,29,30,31',
  '2016,14/04/1959,31,31,31,32,31,31,29,30,30,29,30,30',
  '2017,13/04/1960,31,31,32,31,31,31,30,29,30,29,30,30',
  '2018,13/04/1961,31,32,31,32,31,30,30,29,30,29,30,30',
  '2019,13/04/1962,31,32,31,32,31,30,30,30,29,30,29,31',
  '2020,14/04/1963,31,31,31,32,31,31,30,29,30,29,30,30',
  '2021,13/04/1964,31,31,32,31,31,31,30,29,30,29,30,30',
  '2022,13/04/1965,31,32,31,32,31,30,30,30,29,29,30,30',
  '2023,13/04/1966,31,32,31,32,31,30,30,30,29,30,29,31',
  '2024,14/04/1967,31,31,31,32,31,31,30,29,30,29,30,30',
  '2025,13/04/1968,31,31,32,31,31,31,30,29,30,29,30,30',
  '2026,13/04/1969,31,32,31,32,31,30,30,30,29,29,30,31',
  '2027,14/04/1970,30,32,31,32,31,30,30,30,29,30,29,31',
  '2028,14/04/1971,31,31,32,31,31,31,30,29,30,29,30,30',
  '2029,13/04/1972,31,31,32,31,32,30,30,29,30,29,30,30',
  '2030,13/04/1973,31,32,31,32,31,30,30,30,29,29,30,31',
  '2031,14/04/1974,30,32,31,32,31,30,30,30,29,30,29,31',
  '2032,14/04/1975,31,31,32,31,31,31,30,29,30,29,30,30',
  '2033,13/04/1976,31,31,32,32,31,30,30,29,30,29,30,30',
  '2034,13/04/1977,31,32,31,32,31,30,30,30,29,29,30,31',
  '2035,14/04/1978,30,32,31,32,31,31,29,30,30,29,29,31',
  '2036,14/04/1979,31,31,32,31,31,31,30,29,30,29,30,30',
  '2037,13/04/1980,31,31,32,32,31,30,30,29,30,29,30,30',
  '2038,13/04/1981,31,32,31,32,31,30,30,30,29,29,30,31',
  '2039,14/04/1982,31,31,31,32,31,31,29,30,30,29,30,30',
  '2040,14/04/1983,31,31,32,31,31,31,30,29,30,29,30,30',
  '2041,13/04/1984,31,31,32,32,31,30,30,29,30,29,30,30',
  '2042,13/04/1985,31,32,31,32,31,30,30,30,29,29,30,31',
  '2043,14/04/1986,31,31,31,32,31,31,29,30,30,29,30,30',
  '2044,14/04/1987,31,31,32,31,31,31,30,29,30,29,30,30',
  '2045,13/04/1988,31,32,31,32,31,30,30,29,30,29,30,30',
  '2046,13/04/1989,31,32,31,32,31,30,30,30,29,29,30,31',
  '2047,14/04/1990,31,31,31,32,31,31,30,29,30,29,30,30',
  '2048,14/04/1991,31,31,32,31,31,31,30,29,30,29,30,30',
  '2049,13/04/1992,31,32,31,32,31,30,30,30,29,29,30,30',
  '2050,13/04/1993,31,32,31,32,31,30,30,30,29,30,29,31',
  '2051,14/04/1994,31,31,31,32,31,31,30,29,30,29,30,30',
  '2052,14/04/1995,31,31,32,31,31,31,30,29,30,29,30,30',
  '2053,13/04/1996,31,32,31,32,31,30,30,30,29,29,30,30',
  '2054,13/04/1997,31,32,31,32,31,30,30,30,29,30,29,31',
  '2055,14/04/1998,31,31,32,31,31,31,30,29,30,29,30,30',
  '2056,14/04/1999,31,31,32,31,32,30,30,29,30,29,30,30',
  '2057,13/04/2000,31,32,31,32,31,30,30,30,29,29,30,31',
  '2058,13/04/2001,30,32,31,32,31,30,30,30,29,30,29,31',
  '2059,14/04/2002,31,31,32,31,31,31,30,29,30,29,30,30',
  '2060,14/04/2003,31,31,32,32,31,30,30,29,30,29,30,30',
  '2061,13/04/2004,31,32,31,32,31,30,30,30,29,29,30,31',
  '2062,14/04/2005,31,31,31,32,31,31,29,30,29,30,29,31',
  '2063,14/04/2006,31,31,32,31,31,31,30,29,30,29,30,30',
  '2064,14/04/2007,31,31,32,32,31,30,30,29,30,29,30,30',
  '2065,13/04/2008,31,32,31,32,31,30,30,30,29,29,30,31',
  '2066,14/04/2009,31,31,31,32,31,31,29,30,30,29,29,31',
  '2067,14/04/2010,31,31,32,31,31,31,30,29,30,29,30,30',
  '2068,14/04/2011,31,31,32,32,31,30,30,29,30,29,30,30',
  '2069,13/04/2012,31,32,31,32,31,30,30,30,29,29,30,31',
  '2070,14/04/2013,31,31,31,32,31,31,29,30,30,29,30,30',
  '2071,14/04/2014,31,31,32,31,31,31,30,29,30,29,30,30',
  '2072,14/04/2015,31,32,31,32,31,30,30,29,30,29,30,30',
  '2073,13/04/2016,31,32,31,32,31,30,30,30,29,29,30,31',
  '2074,14/04/2017,31,31,31,32,31,31,30,29,30,29,30,30',
  '2075,14/04/2018,31,31,32,31,31,31,30,29,30,29,30,30',
  '2076,14/04/2019,31,32,31,32,31,30,30,30,29,29,30,30',
  '2077,13/04/2020,31,32,31,32,31,30,30,30,29,30,29,31',
  '2078,14/04/2021,31,31,31,32,31,31,30,29,30,29,30,30',
  '2079,14/04/2022,31,31,32,31,31,31,30,29,30,29,30,30',
  '2080,14/04/2023,31,32,31,32,31,30,30,30,29,29,30,30',
  '2081,13/04/2024,31,32,31,32,31,30,30,30,29,30,29,31',
  '2082,14/04/2025,31,31,32,31,31,31,29,30,29,30,30,30',
  '2083,14/04/2026,31,31,32,31,31,30,30,30,29,30,30,30',
  '2084,14/04/2027,31,31,32,31,31,30,30,30,29,30,30,30',
  '2085,13/04/2028,31,32,31,32,30,31,30,30,29,30,30,30',
  '2086,14/04/2029,30,32,31,32,31,30,30,30,29,30,30,30',
  '2087,14/04/2030,31,31,32,31,31,31,30,29,30,30,30,30',
  '2088,15/04/2031,30,31,32,32,30,31,30,30,29,30,30,30',
  '2089,14/04/2032,30,32,31,32,31,30,30,30,29,30,30,30',
  '2090,14/04/2033,30,32,31,32,31,30,30,30,29,30,30,30',
  '2091,14/04/2034,31,31,32,31,31,31,30,30,29,30,30,30',
  '2092,15/04/2035,30,31,32,32,31,30,30,30,29,30,30,30',
  '2093,14/04/2036,30,32,31,32,31,30,30,30,29,30,30,30',
  '2094,14/04/2037,31,31,32,31,31,30,30,30,29,30,30,30',
  '2095,14/04/2038,31,31,32,31,31,31,30,29,30,30,30,30',
  '2096,15/04/2039,30,31,32,32,31,30,30,29,30,29,30,30',
  '2097,13/04/2040,31,32,31,32,31,30,30,30,29,30,30,30',
  '2098,14/04/2041,31,31,32,31,31,31,29,30,29,30,29,31',
  '2099,14/04/2042,31,31,32,31,31,31,30,29,29,30,30,30',
  '2100,14/04/2043,31,32,31,32,30,31,30,29,30,29,30,30',
];

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BsDate {
  year:  number;
  month: number; // 1-12
  day:   number;
}

export interface BsMonthGrid {
  year:        number;
  month:       number;
  monthName:   string;
  days:        number;
  startDow:    number; // 0=Sun..6=Sat
  firstEngIso: string; // YYYY-MM-DD of day 1
  range:       { min: number; max: number };
}

interface BsYearRecord {
  year:     number;
  anchorMs: number;
  months:   number[]; // [12]
}

interface BsCache {
  years:  BsYearRecord[];
  byYear: Record<number, BsYearRecord>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

export const MONTH_NAMES = [
  'Baisakh','Jestha','Ashad','Shrawan','Bhadra','Aswin',
  'Kartik','Mansir','Poush','Magh','Falgun','Chaitra'
];

export const DAY_NAMES = [
  'Aitabar','Sombar','Mangalbar','Buddhabar','Bihibar','Sukrabar','Sanibar'
];

// ── Private helpers ───────────────────────────────────────────────────────────

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function engToMs(dmy: string): number {
  // 'DD/MM/YYYY' -> UTC millis
  const [d, m, y] = dmy.split('/').map(Number);
  return Date.UTC(y, m - 1, d);
}

function msToIso(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// ── Cache (built once) ────────────────────────────────────────────────────────

let _cache: BsCache | null = null;

function buildCache(): BsCache {
  if (_cache) return _cache;
  const years: BsYearRecord[] = [];
  const byYear: Record<number, BsYearRecord> = {};
  for (const line of BS_RAW) {
    const parts = line.split(',');
    const year     = parseInt(parts[0]!, 10);
    const anchorMs = engToMs(parts[1]!);
    const months   = parts.slice(2).map(Number);
    const rec: BsYearRecord = { year, anchorMs, months };
    years.push(rec);
    byYear[year] = rec;
  }
  _cache = { years, byYear };
  return _cache;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert BS 'YYYY/MM/DD' string to English ISO 'YYYY-MM-DD'.
 * Returns null if the year is outside the table or the date is invalid.
 */
export function nepToEng(nepStr: string): string | null {
  const c = buildCache();
  const [y, m, d] = nepStr.split('/').map(Number);
  if (!y || !m || !d) return null;
  const rec = c.byYear[y];
  if (!rec || m < 1 || m > 12) return null;
  if (d < 1 || d > rec.months[m - 1]!) return null;
  let offset = 0;
  for (let i = 0; i < m - 1; i++) offset += rec.months[i]!;
  offset += d - 1;
  return msToIso(rec.anchorMs + offset * MS_PER_DAY);
}

/**
 * Convert English ISO 'YYYY-MM-DD' to BS 'YYYY/MM/DD'.
 * Returns null if out of table range.
 */
export function engToNep(engStr: string): string | null {
  const c = buildCache();
  const [y, m, d] = engStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  const targetMs = Date.UTC(y, m - 1, d);
  let rec: BsYearRecord | null = null;
  for (const yr of c.years) {
    if (yr.anchorMs <= targetMs) rec = yr;
    else break;
  }
  if (!rec) return null;
  let offset = Math.round((targetMs - rec.anchorMs) / MS_PER_DAY);
  let month = 0;
  while (month < 12 && offset >= rec.months[month]!) {
    offset -= rec.months[month]!;
    month++;
  }
  if (month >= 12) return null;
  return `${rec.year}/${pad2(month + 1)}/${pad2(offset + 1)}`;
}

/** Today's date as BS 'YYYY/MM/DD'. */
export function todayNep(): string {
  const now = new Date();
  const iso = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  return engToNep(iso) ?? '';
}

/** Days in a given BS month. Returns 0 if year is not in the table. */
export function daysInBsMonth(year: number, month: number): number {
  const c = buildCache();
  const rec = c.byYear[year];
  return rec && month >= 1 && month <= 12 ? rec.months[month - 1]! : 0;
}

/** Day-of-week index (0=Sun..6=Sat) of the first day of a BS month. */
export function bsMonthStartDow(year: number, month: number): number {
  const eng = nepToEng(`${year}/${pad2(month)}/01`);
  if (!eng) return 0;
  const [y, m, d] = eng.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Month name (1-based). */
export function bsMonthName(month: number): string {
  return MONTH_NAMES[month - 1] ?? '';
}

/** Year range present in the data table. */
export function bsYearRange(): { min: number; max: number } {
  const c = buildCache();
  return { min: c.years[0]!.year, max: c.years[c.years.length - 1]!.year };
}

/**
 * All data the calendar picker needs for one month — one call, no round-trip.
 * Mirrors the GAS getBsMonthGrid() exactly.
 */
export function getBsMonthGrid(year: number, month: number): BsMonthGrid | null {
  const c = buildCache();
  const rec = c.byYear[year];
  if (!rec) return null;
  const days       = rec.months[month - 1]!;
  const startDow   = bsMonthStartDow(year, month);
  const firstEngIso = nepToEng(`${year}/${pad2(month)}/01`) ?? '';
  return {
    year, month,
    monthName: MONTH_NAMES[month - 1]!,
    days, startDow, firstEngIso,
    range: bsYearRange()
  };
}

/**
 * Convert a BS 'YYYY/MM/DD' string directly to an English ISO string
 * suitable for Postgres date columns.
 */
export function bsToIso(nepStr: string): string | null {
  return nepToEng(nepStr);
}

/**
 * Convert an English ISO 'YYYY-MM-DD' string to a display-friendly
 * BS string 'YYYY/MM/DD'.
 */
export function isoToBs(engStr: string): string | null {
  return engToNep(engStr);
}
