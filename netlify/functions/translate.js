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
    if (len + add > maxChars && buf.length) {
      chunks.push(buf);
      buf = [it];
      len = add;
    } else {
      buf.push(it);
      len += add;
    }
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
  return joined.split(SEP);
}

async function googleTranslate(texts, source, target) {
  const safeChunks = chunkByLength(texts, 1400);
  const out = [];
  for (const ch of safeChunks) {
    const part = await googleTranslateBatch(ch, source, target);
    out.push(...part);
  }
  return out;
}

async function translateXml(xml, source, target) {
  const tags = Array.from(findTextTags(xml));
  if (tags.length === 0) return xml;
  const texts = tags.map(t => t.inner);
  const translated = await googleTranslate(texts, (source || 'en').toLowerCase(), (target || 'ru').toLowerCase());

  let out = '';
  let cursor = 0;
  tags.forEach((tag, idx) => {
    out += xml.slice(cursor, tag.start);
    const replacement = `<a:t>${xmlEscape(translated[idx] ?? '')}</a:t>`;
    out += replacement;
    cursor = tag.end;
  });
  out += xml.slice(cursor);
  return out;
}

module.exports = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Use POST with PPTX binary body.' };
  }

  try {
    const source = (event.queryStringParameters?.source || 'EN');
    const target = (event.queryStringParameters?.target || 'RU');

    if (!event.body) return { statusCode: 400, body: 'Empty body' };
    const buffer = event.isBase64Encoded ? Buffer.from(event.body, 'base64') : Buffer.from(event.body);

    const zip = await JSZip.loadAsync(buffer);

    const fileNames = Object.keys(zip.files).filter(name =>
      (name.startsWith('ppt/slides/slide') && name.endsWith('.xml')) ||
      (name.startsWith('ppt/notesSlides/notesSlide') && name.endsWith('.xml'))
    );

    for (const name of fileNames) {
      const xml = await zip.files[name].async('string');
      const translatedXml = await translateXml(xml, source, target);
      zip.file(name, translatedXml);
    }

    const outBuf = await zip.generateAsync({ type: 'nodebuffer' });

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'Content-Disposition': 'attachment; filename="translated_ru.pptx"'
      },
      body: outBuf.toString('base64'),
      isBase64Encoded: true
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: String(err.message || err) };
  }
};
