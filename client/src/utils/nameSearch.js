// البحث بالاسم — Arabic names, searched in Latin letters (and the other way round).
//
// Everyone here has an Arabic name and a Latin username, and people type
// whichever one is on their keyboard at that moment. "أحمد" gets typed ahmed,
// ahmad, ahmd, a7med; "خالد" gets khalid, khaled, kalid. A plain `includes()`
// finds none of those, so the directory felt broken to anyone whose keyboard
// was in the wrong language.
//
// The fix is to reduce both sides to the same thing: a CONSONANT SKELETON.
// Arabic script writes the consonants and leaves the short vowels out, which is
// exactly the part of a name people spell inconsistently in Latin. Drop the
// vowels from both, fold the letters that share a sound into one class, and
// أحمد and "ahmad" and "ahmd" all become `ahmd`.
//
// Four rules make it work:
//
//   1. A vowel survives only at the head of a word. علي is ع-ل-ي — every letter
//      is a vowel or a throat sound, so dropping all of them leaves "l", which
//      matches half the directory. Keeping the first one gives `al`, and "ali"
//      and "aly" give `al` too.
//   2. Letters fold by sound, not by spelling: خ ك ق all become k, because
//      Qasim / Kassim are the same person to whoever is typing.
//   3. Where a letter really is ambiguous, BOTH readings are produced. "th" is
//      ث in عثمان but ت+ح in فتحي; Latin "g" is ج in Jamal but ق in Gambar;
//      ة is heard in "fatimah" and not in "fatima". Nothing in the query says
//      which, so the query matches if either reading does.
//   4. Names are indexed word by word, in adjacent pairs, and whole — because
//      عبد الله gets typed "abdullah", and عطية الله gets typed "ateyatalla".
//      The ال- article is indexed both with and without, so "abbasi" finds
//      العباسي.
//
// Plain substring search still runs first, so extensions, emails and exact
// Arabic keep behaving the way they always did. The skeleton is only ever an
// extra way to match, never a way to lose a result.

// ── Arabic ────────────────────────────────────────────────────────────────

// Tashkeel, superscript alef and tatweel carry no consonant — they are noise
// for matching and get pasted in inconsistently anyway.
const AR_MARKS = /[ً-ٰٟۖ-ۭـ]/g;

// Sound classes, not letters. Anything on the same row is indistinguishable to
// someone spelling the name out in Latin.
const AR_CONSONANT = {
  'ب': 'b', 'پ': 'b',
  'ت': 't', 'ط': 't',
  'ث': 's', 'س': 's', 'ص': 's', 'ش': 's',
  'ج': 'j', 'غ': 'j', 'چ': 'j',
  'ح': 'h', 'ه': 'h',
  'خ': 'k', 'ك': 'k', 'ق': 'k', 'گ': 'k', 'ک': 'k',
  'د': 'd', 'ض': 'd',
  'ذ': 'z', 'ز': 'z', 'ظ': 'z', 'ژ': 'z',
  'ر': 'r',
  'ف': 'f', 'ڤ': 'f',
  'ل': 'l', 'م': 'm', 'ن': 'n',
};

// Alef in all its forms, hamza in all its seats, and ع — none of them is a
// consonant an English speaker would hear, so they survive only as the opening
// vowel of a word: عبدالله → `abdlh`, which is what "abdullah" reduces to.
const AR_SOFT = new Set('اأإآٱءؤئع');
const AR_WAW  = new Set('وۆۇ');
const AR_YA   = new Set('يیىۍ');

// ── Latin ─────────────────────────────────────────────────────────────────

const LAT_CONSONANT = {
  b: 'b', p: 'b',
  t: 't',
  s: 's', c: 'k', k: 'k', q: 'k',
  j: 'j',
  h: 'h',
  d: 'd',
  z: 'z',
  r: 'r', l: 'l', m: 'm', n: 'n',
  f: 'f', v: 'f',
};

// Chat-alphabet digits. Only honoured inside a token that also has letters, so
// searching an extension like 5022 still means the number 5022.
const ARABIZI = { '7': 'h', '5': 'k', '9': 's', '6': 't', '8': 'k', '4': 'z' };
const ARABIZI_SOFT = new Set(['3', '2']);   // ع and ء

// Digraphs with exactly one sensible reading.
const LAT_DIGRAPH = { kh: 'k', gh: 'j', ph: 'f', ck: 'k' };

// Two readings, both real. "th" is ث (othman) or ت+ح (fathi); "g" is ج (jamal)
// or ق (gambar, which the directory spells قمبر).
const LAT_AMBIGUOUS = {
  th: ['s', 'th'],
  sh: ['s', 'sh'],
  dh: ['z', 'dh'],
  ch: ['s', 'k'],
};
const LAT_AMBIGUOUS_1 = { g: ['j', 'k'] };

const LAT_VOWEL = new Set('aeiou');
const MAX_VARIANTS = 12;

const isArabicChar = ch => ch >= '؀' && ch <= 'ۿ';

// Same word, same shape: strips tashkeel and folds the alef / ya / hamza
// variants people type interchangeably. Used on the plain-substring path, so
// "احمد" finds "أحمد" without going anywhere near the skeleton. ة is left
// alone here — the skeleton decides whether it is heard.
export function normalizeArabic(s) {
  return String(s || '')
    .replace(AR_MARKS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي');
}

// One word → every skeleton it could reasonably stand for. Usually a single
// string; more when the word holds an ambiguous letter.
function wordSkeletons(word) {
  const w = normalizeArabic(word).toLowerCase();
  if (!w) return [];

  const hasLetter = /[a-z؀-ۿ]/.test(w);
  let out = [''];
  const emit = piece => { out = out.map(s => s + piece); };
  const branch = pieces => {
    const next = [];
    for (const s of out) for (const p of pieces) next.push(s + p);
    out = next.length > MAX_VARIANTS ? next.slice(0, MAX_VARIANTS) : next;
  };

  for (let i = 0; i < w.length; i++) {
    const ch = w[i];
    const first = i === 0;

    if (isArabicChar(ch)) {
      if (AR_CONSONANT[ch]) { emit(AR_CONSONANT[ch]); continue; }
      // ة is heard three ways: "fatimah", "hayat", "fatima" — index all three.
      if (ch === 'ة')       { branch(['h', 't', '']); continue; }
      if (AR_SOFT.has(ch))  { emit(first ? 'a' : ''); continue; }
      if (AR_WAW.has(ch))   { emit(first ? 'w' : ''); continue; }
      if (AR_YA.has(ch))    { emit(first ? 'y' : ''); continue; }
      continue;                                      // anything else: no sound
    }

    const pair = w.slice(i, i + 2);
    if (LAT_AMBIGUOUS[pair]) { branch(LAT_AMBIGUOUS[pair]); i++; continue; }
    if (LAT_DIGRAPH[pair])   { emit(LAT_DIGRAPH[pair]);     i++; continue; }

    if (LAT_AMBIGUOUS_1[ch]) { branch(LAT_AMBIGUOUS_1[ch]); continue; }
    if (LAT_CONSONANT[ch])   { emit(LAT_CONSONANT[ch]); continue; }
    if (ch === 'x')          { emit('ks'); continue; }
    if (LAT_VOWEL.has(ch))   { emit(first ? 'a' : ''); continue; }
    if (ch === 'w')          { emit(first ? 'w' : ''); continue; }
    if (ch === 'y')          { emit(first ? 'y' : ''); continue; }

    if (hasLetter && ARABIZI[ch])          { emit(ARABIZI[ch]); continue; }
    if (hasLetter && ARABIZI_SOFT.has(ch)) { emit(first ? 'a' : ''); continue; }
    // digits in a bare number, punctuation, anything else — carries no sound
  }

  // A doubled letter is a spelling choice, not a sound: Hussain / Husain,
  // Abdullah / Abdulah.
  return [...new Set(out.map(s => s.replace(/(.)\1+/g, '$1')).filter(Boolean))];
}

const WORD_SPLIT = /[\s،,._\-/\\()[\]|+'"]+/;

// Surnames are looked up without their article far more often than with it:
// people type "abbasi", not "alabbasi". Both go in the index.
function articleStripped(w) {
  const s = normalizeArabic(w);
  if (/^ال./.test(s) && s.length > 3)          return s.slice(2);
  if (/^(al|el)[a-z]{3}/i.test(s))             return s.slice(2);
  return null;
}

function formsOfWord(w) {
  const bare = articleStripped(w);
  return bare ? [...wordSkeletons(w), ...wordSkeletons(bare)] : wordSkeletons(w);
}

/**
 * Build the searchable form of one record, once. Keep the result on the row (a
 * `useMemo` over the list) — it is stable for as long as the data is.
 *
 * @param names    fields that get the full cross-script treatment — the
 *                 person's name, username, email addresses
 * @param literal  fields that stay literal: department, role, extension,
 *                 mobile. These are read off the screen and typed exactly, and
 *                 putting them through the skeleton only leaks them into name
 *                 searches — الشرعي and الشعراوي reduce to the same four
 *                 sounds, so a whole department used to answer to one surname.
 */
export function searchIndex(names, literal = []) {
  const clean = v => (v || []).filter(x => x !== null && x !== undefined && x !== '');
  const list = clean(names);
  const forms = new Set();

  for (const value of list) {
    const words = String(value).split(WORD_SPLIT).filter(Boolean);
    if (!words.length) continue;

    words.forEach(w => formsOfWord(w).forEach(f => forms.add(f)));
    // Adjacent pairs, because two Arabic words are often one Latin word:
    // عبد الله → "abdullah", عطية الله → "ateyatalla".
    for (let i = 0; i < words.length - 1; i++) {
      wordSkeletons(words[i] + words[i + 1]).forEach(f => forms.add(f));
    }
    if (words.length > 2) wordSkeletons(words.join('')).forEach(f => forms.add(f));
  }

  return {
    raw: [...list, ...clean(literal)]
      .map(v => normalizeArabic(String(v)).toLowerCase()).join('   '),
    skel: [...forms].join(' '),
    words: [...forms],
  };
}

// "mohd" for محمد — a letter short of the real skeleton. Allowed only when the
// query is already specific (3+ sounds), the gap is a single letter, and the
// two agree on their first two sounds. That last condition is what keeps
// "ahmed" out of الحميدي and الحماد, whose skeletons differ from أحمد's by
// exactly the `l` of the ال- article.
function nearSubsequence(q, word) {
  if (q.length < 3 || word.length !== q.length + 1) return false;
  if (!word.startsWith(q.slice(0, 2))) return false;
  let i = 0;
  for (const ch of word) if (ch === q[i]) i++;
  return i === q.length;
}

// How loosely a skeleton is allowed to land depends on how much of it there is.
//
// علي reduces to just `al` — and so does the ال- article on almost every
// surname in the directory, so a free substring search for it returns two
// thirds of the staff. A two-sound skeleton therefore has to BE a whole name;
// a three-sound one has to START one; only at four does it become specific
// enough to match anywhere inside a name.
function landsIn(index, s) {
  if (s.length <= 2) return index.words.includes(s);
  if (s.length === 3) return index.words.some(w => w.startsWith(s));
  return index.skel.includes(s);
}

/**
 * Turn a query into a test. Every word the person typed has to land somewhere
 * in the record — so "ahmed ali" finds أحمد خيري علي, whatever the order — but
 * each word may land either literally or through its skeleton.
 *
 * Returns null for an empty query, which callers read as "match everything".
 */
export function makeMatcher(query) {
  const q = normalizeArabic(String(query || '')).trim().toLowerCase();
  if (!q) return null;

  const tokens = q.split(/\s+/).filter(Boolean).map(tok => ({
    raw: tok,
    // A one-letter skeleton matches nearly every name, so it is not used — such
    // a query falls back to plain substring, which is what was meant by it.
    skels: formsOfWord(tok).filter(s => s.length >= 2),
    // The forgiving pass is for people typing an Arabic name in Latin, where
    // the spelling is a guess. Someone typing Arabic is using the same script
    // the names are stored in and has no reason to be a letter off — running
    // the loose pass on their query only drags in near-misses, which is how
    // الشعراوي used to return everyone in الموارد البشرية.
    loose: /[a-z]/.test(tok),
  }));
  if (!tokens.length) return null;

  return index => {
    if (!index) return false;
    return tokens.every(tk =>
      index.raw.includes(tk.raw)
      || tk.skels.some(s => landsIn(index, s))
      || (tk.loose && tk.skels.some(s => index.words.some(w => nearSubsequence(s, w)))));
  };
}
