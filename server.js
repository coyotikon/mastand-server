const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');
const { ExpressPeerServer } = require('peer');
const { readDB, writeDB } = require('./db');
const moders = require('./moders');

const app = express();
app.use(cors());
app.use(express.json({ limit: '25mb' })); // fotos/posts em base64 no feed/status

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// ---------- Sessoes simples (token em memoria) ----------
const sessions = {}; // token -> makey

function auth(req, res, next) {
  const token = req.headers['authorization'];
  const makey = sessions[token];
  if (!makey) return res.status(401).json({ error: 'nao autenticado' });
  req.makey = makey;
  next();
}

const MAKEY_REGEX = /^[A-Z_\-.@]{3,24}$/;

function publicUser(u) {
  if (!u) return null;
  const { passwordHash, ...rest } = u;
  return rest;
}

// ---------- Auth ----------
app.post('/api/register', async (req, res) => {
  const { username, makey, password, publicKey } = req.body;
  if (!username || !makey || !password || !publicKey) {
    return res.status(400).json({ error: 'campos obrigatorios: username, makey, password, publicKey' });
  }
  if (!MAKEY_REGEX.test(makey)) {
    return res.status(400).json({ error: 'Makey invalida: use so A-Z e _ - . @, sem numeros' });
  }
  
  const db = await readDB(); // CORRIGIDO
  
  if (db.users.some(u => u.makey === makey)) return res.status(409).json({ error: 'Makey ja existe' });
  if (db.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return res.status(409).json({ error: 'nome de usuario ja existe' });
  }
  const passwordHash = await bcrypt.hash(password, 10);
  const user = {
    id: uuidv4(), username, makey, passwordHash, publicKey,
    bio: '', avatar: '', groupFolders: {}, createdAt: Date.now()
  };
  db.users.push(user);
  await writeDB(db);
  const token = uuidv4();
  sessions[token] = makey;
  res.json({ token, user: publicUser(user) });
});

app.post('/api/login', async (req, res) => {
  const { identifier, password } = req.body; // identifier = username OU makey
  
  const db = await readDB(); // CORRIGIDO
  
  const user = db.users.find(u =>
    u.makey === identifier || u.username.toLowerCase() === String(identifier || '').toLowerCase()
  );
  if (!user) return res.status(404).json({ error: 'usuario nao encontrado' });
  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return res.status(401).json({ error: 'senha incorreta' });
  const token = uuidv4();
  sessions[token] = user.makey;
  res.json({ token, user: publicUser(user) });
});

// ---------- Perfil ----------
// CORRIGIDO: adicionado async
app.get('/api/me', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  res.json(publicUser(db.users.find(u => u.makey === req.makey)));
});

app.post('/api/profile', auth, async (req, res) => {
  const { bio, avatar, newMakey } = req.body;
  
  const db = await readDB(); // CORRIGIDO
  
  const user = db.users.find(u => u.makey === req.makey);
  if (!user) return res.status(404).json({ error: 'usuario nao encontrado' });
  if (newMakey && newMakey !== user.makey) {
    if (!MAKEY_REGEX.test(newMakey)) return res.status(400).json({ error: 'Makey invalida' });
    if (db.users.some(u => u.makey === newMakey)) return res.status(409).json({ error: 'Makey ja existe' });
    user.makey = newMakey;
    sessions[req.headers['authorization']] = newMakey;
  }
  if (typeof bio === 'string') user.bio = moders.cleanText(bio);
  if (typeof avatar === 'string') user.avatar = avatar;
  await writeDB(db);
  res.json(publicUser(user));
});

// ---------- Busca (por Makey ou Nametag) ----------
// CORRIGIDO: adicionado async
app.get('/api/search', async (req, res) => {
  const q = (req.query.q || '').toLowerCase();
  
  const db = await readDB(); // CORRIGIDO
  
  res.json(
    db.users.filter(u => u.makey.toLowerCase().includes(q) || u.username.toLowerCase().includes(q))
      .map(publicUser)
  );
});

// CORRIGIDO: adicionado async
app.get('/api/user/:makey', async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const user = db.users.find(u => u.makey === req.params.makey);
  if (!user) return res.status(404).json({ error: 'nao encontrado' });
  res.json(publicUser(user));
});

// ---------- Presenca em tempo real ----------
const online = new Map(); // makey -> socket.id

io.on('connection', socket => {
  const { makey } = socket.handshake.query;
  if (makey) {
    online.set(makey, socket.id);
    io.emit('presence:update', Array.from(online.keys()));
  }
  socket.on('disconnect', () => {
    if (makey) {
      online.delete(makey);
      io.emit('presence:update', Array.from(online.keys()));
    }
  });
});

app.get('/api/online', (req, res) => res.json(Array.from(online.keys())));

// ---------- Grupos, subgrupos, pastas ----------
app.post('/api/groups', auth, async (req, res) => {
  const { name, parentGroupId } = req.body;
  if (!name) return res.status(400).json({ error: 'nome obrigatorio' });
  
  const db = await readDB(); // CORRIGIDO
  
  const group = {
    id: uuidv4(), name: moders.cleanText(name), parentGroupId: parentGroupId || null,
    admins: [req.makey], members: [req.makey],
    mabot: { welcomeMessage: '', keywordBlacklist: [], antiFlood: false, antiLink: false },
    createdAt: Date.now()
  };
  db.groups.push(group);
  await writeDB(db);
  res.json(group);
});

// CORRIGIDO: adicionado async
app.get('/api/groups/mine', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  res.json(db.groups.filter(g => g.members.includes(req.makey)));
});

app.post('/api/groups/:id/join', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'grupo nao encontrado' });
  if (!group.members.includes(req.makey)) group.members.push(req.makey);
  await writeDB(db);
  res.json({ group, welcomeMessage: group.mabot.welcomeMessage });
});

app.post('/api/groups/:id/leave', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'grupo nao encontrado' });
  group.members = group.members.filter(m => m !== req.makey);
  await writeDB(db);
  res.json({ ok: true });
});

app.post('/api/groups/:id/mabot', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'grupo nao encontrado' });
  if (!group.admins.includes(req.makey)) return res.status(403).json({ error: 'so admins configuram o mabot' });
  const { welcomeMessage, keywordBlacklist, antiFlood, antiLink } = req.body;
  if (welcomeMessage !== undefined) group.mabot.welcomeMessage = welcomeMessage;
  if (Array.isArray(keywordBlacklist)) group.mabot.keywordBlacklist = keywordBlacklist;
  if (antiFlood !== undefined) group.mabot.antiFlood = !!antiFlood;
  if (antiLink !== undefined) group.mabot.antiLink = !!antiLink;
  await writeDB(db);
  res.json(group);
});

// Usado tanto por um admin manualmente quanto pelo mini-mabot (viaMabot: true) rodando
// no cliente de quem detectou a violacao — ver public/js/groups.js.
app.post('/api/groups/:id/kick', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const group = db.groups.find(g => g.id === req.params.id);
  if (!group) return res.status(404).json({ error: 'grupo nao encontrado' });
  const { targetMakey, viaMabot } = req.body;
  const isAdmin = group.admins.includes(req.makey);
  if (!isAdmin && !viaMabot) return res.status(403).json({ error: 'sem permissao' });
  group.members = group.members.filter(m => m !== targetMakey);
  await writeDB(db);
  io.emit('group:kick', { groupId: group.id, targetMakey });
  res.json({ ok: true });
});

app.post('/api/groups/:id/folder', auth, async (req, res) => {
  const { folder } = req.body;
  
  const db = await readDB(); // CORRIGIDO
  
  const user = db.users.find(u => u.makey === req.makey);
  user.groupFolders[req.params.id] = folder;
  await writeDB(db);
  res.json({ ok: true });
});

// ---------- Mafeed ----------
app.post('/api/posts', auth, async (req, res) => {
  const { type, media, caption, reel } = req.body;
  if (moders.containsBadWords(caption || '')) return res.status(400).json({ error: 'legenda contem termos bloqueados' });
  
  const db = await readDB(); // CORRIGIDO
  
  const post = {
    id: uuidv4(), authorMakey: req.makey, type, media, caption: moders.cleanText(caption || ''),
    reel: !!reel, likes: [], comments: [], createdAt: Date.now()
  };
  db.posts.push(post);
  await writeDB(db);
  res.json(post);
});

// CORRIGIDO: adicionado async
app.get('/api/posts', async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  res.json(db.posts.slice().reverse());
});

app.post('/api/posts/:id/like', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'post nao encontrado' });
  post.likes = post.likes.includes(req.makey) ? post.likes.filter(m => m !== req.makey) : [...post.likes, req.makey];
  await writeDB(db);
  res.json(post);
});

app.post('/api/posts/:id/comment', auth, async (req, res) => {
  const { text } = req.body;
  if (moders.containsBadWords(text || '')) return res.status(400).json({ error: 'comentario bloqueado' });
  
  const db = await readDB(); // CORRIGIDO
  
  const post = db.posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ error: 'post nao encontrado' });
  post.comments.push({ authorMakey: req.makey, text: moders.cleanText(text), createdAt: Date.now() });
  await writeDB(db);
  res.json(post);
});

// CORRIGIDO: adicionado async
app.get('/api/suggestions', auth, async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const others = db.users.filter(u => u.makey !== req.makey).map(publicUser);
  res.json(others.sort(() => Math.random() - 0.5).slice(0, 8));
});

// ---------- Status (24h) ----------
const STATUS_TTL = 24 * 60 * 60 * 1000;

app.post('/api/status', auth, async (req, res) => {
  const { type, media, text } = req.body;
  
  const db = await readDB(); // CORRIGIDO
  
  const entry = { id: uuidv4(), authorMakey: req.makey, type, media, text: moders.cleanText(text || ''), createdAt: Date.now() };
  db.status.push(entry);
  await writeDB(db);
  res.json(entry);
});

// CORRIGIDO: adicionado async
app.get('/api/status', async (req, res) => {
  const db = await readDB(); // CORRIGIDO
  const now = Date.now();
  const active = db.status.filter(s => now - s.createdAt < STATUS_TTL);
  if (active.length !== db.status.length) { 
    db.status = active; 
    await writeDB(db); // CORRIGIDO: Adicionado await no writeDB aqui também!
  }
  res.json(active);
});

// ---------- PeerJS: servidor de sinalizacao proprio ----------
const peerServer = ExpressPeerServer(server, { path: '/peerjs' });
app.use('/peerjs', peerServer);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Mastand rodando na porta ${PORT}`));
