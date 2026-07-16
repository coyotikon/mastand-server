// db.js — o "banco" e o proprio db.json. Leitura sincrona + fila de escrita simples.
// Observacao: leitura+escrita nao e atomica entre requisicoes simultaneas — ok pra
// escala de demo/projeto pessoal, nao pra alta concorrencia real.

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'db.json');
const EMPTY = { users: [], groups: [], posts: [], status: [] };

function readDB() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify(EMPTY, null, 2));
    return { ...EMPTY };
  }
  const raw = fs.readFileSync(DB_PATH, 'utf-8');
  return raw ? JSON.parse(raw) : { ...EMPTY };
}

let writing = false;
const queue = [];

function writeDB(data) {
  return new Promise((resolve, reject) => {
    queue.push({ data, resolve, reject });
    processQueue();
  });
}

function processQueue() {
  if (writing || queue.length === 0) return;
  writing = true;
  const { data, resolve, reject } = queue.shift();
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    resolve(data);
  } catch (err) {
    reject(err);
  } finally {
    writing = false;
    processQueue();
  }
}

module.exports = { readDB, writeDB };
