// server/utils/uploadName.js
//
// Busboy — which multer sits on — decodes a multipart filename as latin1. For an
// ASCII name that is harmless, but an Arabic one arrives as mojibake: «رد.pdf»
// is stored as «Ø±Ø¯.pdf», and that is the name the user gets back on download.
// The letter ر is UTF-8 D8 B1; read as latin1 those two bytes are Ø and ±.
//
// So take the string back to its raw bytes and re-decode as UTF-8. The guard
// matters: a filename that genuinely was latin1 — «café.pdf» typed on a Windows
// machine, bytes 63 61 66 E9 — is not valid UTF-8, and Node marks the failure
// with U+FFFD. In that case the original is already correct and is kept.
// A pure-ASCII name decodes identically either way, so it is never touched.
function decodeUploadName(name) {
  if (!name) return name;
  const utf8 = Buffer.from(name, 'latin1').toString('utf8');
  return utf8.includes('�') ? name : utf8;
}

module.exports = { decodeUploadName };
