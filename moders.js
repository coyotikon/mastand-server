// moders.js — modulo unico de moderacao do Mastand.
// Cobre: palavras ofensivas, anti-flood, anti-link, anti-bot/spam e a avaliacao do
// mini-mabot dos grupos. Tudo aqui e funcional de verdade.
//
// O que este arquivo NAO faz, de proposito: detectar nudez ou material de abuso
// infantil (CP) em imagem/video. Ver aviso no final — nao da pra improvisar isso.

const Filter = require('bad-words');
const filter = new Filter();

// Adicione aqui termos extras (ex.: em portugues) que queira bloquear:
const extraWords = [];
if (extraWords.length) filter.addWords(...extraWords);

function containsBadWords(text) {
  if (!text) return false;
  try { return filter.isProfane(text); } catch { return false; }
}

function cleanText(text) {
  if (!text) return '';
  try { return filter.clean(text); } catch { return text; }
}

// ---------- Anti-flood ----------
const messageLog = new Map(); // userId -> timestamps[]

function checkFlood(userId, limit = 6, windowMs = 10000) {
  const now = Date.now();
  const list = (messageLog.get(userId) || []).filter(t => now - t < windowMs);
  list.push(now);
  messageLog.set(userId, list);
  return list.length > limit;
}

// ---------- Anti-link ----------
const URL_REGEX = /(https?:\/\/[^\s]+)|(\bwww\.[^\s]+)/i;
function containsLink(text) {
  return URL_REGEX.test(text || '');
}

// ---------- Anti-bot / spam ----------
const lastMessage = new Map(); // userId -> ultimo texto
function looksLikeSpam(userId, text) {
  const prev = lastMessage.get(userId);
  lastMessage.set(userId, text);
  if (prev && prev === text) return true;          // mensagem identica repetida
  if (/(.)\1{9,}/.test(text || '')) return true;    // 10+ caracteres repetidos seguidos
  return false;
}

// ---------- Avaliacao do mini-mabot (grupos) ----------
// config: { welcomeMessage, keywordBlacklist: [], antiFlood: bool, antiLink: bool }
function evaluateMabot(config, userId, text) {
  if (config.antiFlood && checkFlood(userId)) return { action: 'mute', reason: 'flood' };
  if (config.antiLink && containsLink(text)) return { action: 'delete', reason: 'link' };
  const kw = (config.keywordBlacklist || []).find(k => text.toLowerCase().includes(String(k).toLowerCase()));
  if (kw) return { action: 'kick', reason: 'keyword', matched: kw };
  if (containsBadWords(text)) return { action: 'warn', reason: 'badword' };
  if (looksLikeSpam(userId, text)) return { action: 'warn', reason: 'spam' };
  return { action: null, reason: null };
}

/*
 * IMAGEM/VIDEO — nudez e CSAM (material de abuso infantil):
 * De proposito, este arquivo nao inclui um "detector" caseiro pra isso, porque:
 * 1) Deteccao real de nudez precisa de um modelo de visao treinado (ex.: Google Cloud
 *    Vision SafeSearch, AWS Rekognition Moderation, Azure Content Moderator).
 * 2) Deteccao de CSAM nao e algo que se programa do zero: as ferramentas legitimas
 *    (Microsoft PhotoDNA, Thorn Safer, Google CSAI Match) comparam hashes contra bases
 *    mantidas por NCMEC/IWF, e so sao liberadas mediante registro legal como provedor
 *    de servico — isso e proposital, nao uma falha do setor.
 * Antes de liberar upload de midia em producao, plugue checkImageSafety em um desses
 * servicos reais.
 */
async function checkImageSafety() {
  throw new Error('checkImageSafety: integre um provedor real antes de liberar uploads em producao.');
}

module.exports = {
  containsBadWords, cleanText, checkFlood, containsLink, looksLikeSpam,
  evaluateMabot, checkImageSafety
};
