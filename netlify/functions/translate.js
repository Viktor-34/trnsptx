// Netlify Function (CommonJS): translates PPTX by rewriting <a:t>…</a:t> in slide XML.
// Uses free Google Translate (unofficial). No API key required.

const JSZip = require('jszip');

function xmlEscape(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function* findTextTags(xml) {
  const re = /<a:t[^>]*>([\s\S]*?)<\/a:t>/g;
  let m;
  while ((m = re.exec(xml))) {
    yield { match: m[0], start: m.index, end: re.lastIndex, inner: m[1] };
  }
}

function chunkByLength(items, maxChars) {
  const chunks = [];
  let buf = [];
  let len = 0;
  for (const it of items) {
    const add = it.length + 11;
    if (len + add > maxChars && buf.length) { chunks.push(buf); buf = [it]; len = add; }
    else { buf.push(it); len += add; }
  }
  if (buf.length) chunks.push(buf);
  return chunks;
}

async function googleTranslateBatch(texts, source, target) {
  const SEP = '|||SEP|||';
  const q = texts.join(`\n${SEP}\n`);
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${encodeURIComponent(source)}&tl=${encodeURIComponent(target)}&dt=t&q=${encodeURIComponent(q)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Google Translate error ' + res.status);
  const data = await res.json();
  const joined = (data[0] || []).map(x => x[0]).join('');
  return joined
