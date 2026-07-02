// Free, on-demand AR<->EN translation for chat messages, via the MyMemory API
// (no key required). Results are cached by the caller (messages.translated_en /
// translated_ar columns) so each message is only ever translated once.

const ARABIC_RE = /[؀-ۿ]/;

// Arabic-script presence is enough to tell AR from EN for this app's traffic —
// no need for a real language-detection call.
function detectLang(text) {
  return ARABIC_RE.test(text) ? 'ar' : 'en';
}

async function translateText(text, targetLang) {
  const sourceLang = targetLang === 'ar' ? 'en' : 'ar';
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${sourceLang}|${targetLang}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Translation request failed: ${res.status}`);
  const data = await res.json();
  const translated = data?.responseData?.translatedText;
  if (!translated) throw new Error('Translation response missing text');
  return translated;
}

module.exports = { detectLang, translateText };
