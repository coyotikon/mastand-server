// db.js — o "banco" agora mora no MongoDB Atlas (gratis pra sempre), nao mais num
// arquivo local. A FORMA dos dados continua igual: um objeto com users/groups/posts/status —
// so o lugar onde ele mora que mudou. Por isso o resto do server.js quase nao muda.

const { MongoClient } = require('mongodb');

const uri = process.env.MONGODB_URI;
if (!uri) console.error('Faltou configurar a variavel MONGODB_URI no Render (aba Environment).');

const client = new MongoClient(uri);
let colPromise = null;

function getCollection() {
  if (!colPromise) {
    colPromise = client.connect().then(() => client.db('mastand').collection('estado'));
  }
  return colPromise;
}

const EMPTY = { users: [], groups: [], posts: [], status: [] };

async function readDB() {
  const col = await getCollection();
  const doc = await col.findOne({ _id: 'principal' });
  if (!doc) {
    await col.insertOne({ _id: 'principal', ...EMPTY });
    return { ...EMPTY };
  }
  const { _id, ...data } = doc;
  return data;
}

async function writeDB(data) {
  const col = await getCollection();
  await col.replaceOne({ _id: 'principal' }, { _id: 'principal', ...data }, { upsert: true });
  return data;
}

module.exports = { readDB, writeDB };
