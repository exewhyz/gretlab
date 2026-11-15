/**
 * The library's problems were first addressed by number (p1…p30, their ids in
 * seed-data/content.json); migration 0071 gave them readable slugs. Older suites still use
 * the numbers, which keep working (lookups accept former slugs); a check that compares
 * slugs or writes SQL uses READABLE["p2"] for the current one.
 */
export const READABLE = {
  p1: 'simple-interest',
  p2: 'integer-operations',
  p3: 'duration-formatter',
  p4: 'rectangle-measurements',
  p5: 'complex-number-details',
  p6: 'quadratic-equation-roots',
  p7: 'palindrome-checker',
  p8: 'word-operations',
  p9: 'caesar-cipher',
  p10: 'leap-year',
  p11: 'day-of-the-week',
  p12: 'triangle-classifier',
  p13: 'multiplication-table',
  p14: 'digit-operations',
  p15: 'gcd-and-lcm',
  p16: 'second-largest',
  p17: 'rotate-a-list',
  p18: 'rank-list',
  p19: 'word-frequency',
  p20: 'two-list-comparison',
  p21: 'anagram-groups',
  p22: 'factorial-and-combinations',
  p23: 'map-filter-and-lambda',
  p24: 'callback-calculator',
  p25: 'multiples-of-3-or-5',
  p26: 'dict-and-set-comprehensions',
  p27: 'matrix-transpose',
  p28: 'safe-division',
  p29: 'days-between-dates',
  p30: 'file-word-count',
}
