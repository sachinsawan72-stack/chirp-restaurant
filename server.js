// Chirp Restaurant - Backend Server (Express + JSON file storage on persistent disk)
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'chirp123'; // Render me environment variable se change karo

// ---------- DATA_DIR: yehi asli fix hai ----------
// Local pe chalate waqt DATA_DIR set nahi hoga, to yeh apne aap project ke andar
// wali 'data' folder use karega (jaisa pehle tha).
// Render pe DATA_DIR ko persistent disk ke mount path par set karo (jaise /var/data),
// taaki restart/redeploy hone par bhi data wahi ka wahi rahe.
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const UPLOADS_DIR = process.env.UPLOADS_DIR || path.join(DATA_DIR, 'uploads');

const MENU_FILE = path.join(DATA_DIR, 'menu.json');
const ORDERS_FILE = path.join(DATA_DIR, 'orders.json');

// Agar disk khali hai (pehli baar mount hua hai) to zaroori folders bana do
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// ---------- Seeding: agar persistent disk par pehli baar menu.json nahi hai,
// to repo ke andar wale seed data (data-seed/menu.json) se ek baar copy kar do.
// Isse purana menu data disk par migrate ho jata hai, aur uske baad
// sab changes disk par hi save/permanent rahenge.
const SEED_DIR = path.join(__dirname, 'data-seed');

if (!fs.existsSync(MENU_FILE)) {
  const seedMenu = path.join(SEED_DIR, 'menu.json');
  if (fs.existsSync(seedMenu)) {
    fs.copyFileSync(seedMenu, MENU_FILE);
    console.log('✅ menu.json seed se disk par copy ho gaya (pehli baar).');
  } else {
    fs.writeFileSync(MENU_FILE, '[]');
  }
}

if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, '[]');
}

// ---------- Multer setup (image upload) ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const safeName = `item-${req.params.id}-${Date.now()}${ext}`;
    cb(null, safeName);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // max 5MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Sirf image files allowed hain (jpg, png, webp, gif)'));
    }
    cb(null, true);
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
// Uploads ab persistent disk par hai (public folder ke andar nahi), isliye
// isko explicitly '/uploads' route par serve karna hoga.
app.use('/uploads', express.static(UPLOADS_DIR));

// ---------- Helpers ----------
function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function checkAdmin(req, res, next) {
  const key = req.header('x-admin-key');
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Admin key galat hai.' });
  }
  next();
}

// ---------- Public API ----------

app.get('/api/menu', (req, res) => {
  const menu = readJSON(MENU_FILE);
  res.json(menu);
});

app.post('/api/orders', (req, res) => {
  const { items, customerName, customerPhone, tableNumber } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart khali hai, kam se kam 1 item chahiye.' });
  }

  const menu = readJSON(MENU_FILE);
  let total = 0;
  const orderItems = items.map(ci => {
    const menuItem = menu.find(m => m.id === ci.id);
    if (!menuItem) return null;
    const qty = Math.max(1, parseInt(ci.quantity) || 1);
    total += menuItem.price * qty;
    return { id: menuItem.id, name: menuItem.name, price: menuItem.price, quantity: qty };
  }).filter(Boolean);

  if (orderItems.length === 0) {
    return res.status(400).json({ error: 'Order me valid items nahi mile.' });
  }

  const orders = readJSON(ORDERS_FILE);
  const order = {
    id: Date.now(),
    items: orderItems,
    total: Math.round(total * 100) / 100,
    customerName: customerName || 'Guest',
    customerPhone: customerPhone || '',
    tableNumber: tableNumber || '',
    status: 'received',
    createdAt: new Date().toISOString()
  };

  orders.push(order);
  writeJSON(ORDERS_FILE, orders);

  res.status(201).json({ message: 'Order successfully mil gaya!', order });
});

// ---------- Admin API (protected by x-admin-key header) ----------

app.get('/api/admin/orders', checkAdmin, (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  res.json(orders.reverse());
});

app.patch('/api/admin/orders/:id', checkAdmin, (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order nahi mila.' });
  order.status = req.body.status || order.status;
  writeJSON(ORDERS_FILE, orders);
  res.json(order);
});

app.patch('/api/admin/menu/:id', checkAdmin, (req, res) => {
  const menu = readJSON(MENU_FILE);
  const item = menu.find(m => m.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Menu item nahi mila.' });

  if (typeof req.body.name === 'string' && req.body.name.trim()) item.name = req.body.name.trim();
  if (typeof req.body.category === 'string' && req.body.category.trim()) item.category = req.body.category.trim();
  if (typeof req.body.emoji === 'string' && req.body.emoji.trim()) item.emoji = req.body.emoji.trim();
  if (typeof req.body.image === 'string') item.image = req.body.image;
  if (req.body.price !== undefined && !isNaN(parseFloat(req.body.price))) item.price = parseFloat(req.body.price);
  if (typeof req.body.description === 'string') item.description = req.body.description;
  if (req.body.available !== undefined) item.available = !!req.body.available; // pehle yeh missing tha, isliye toggle save nahi hota tha

  writeJSON(MENU_FILE, menu);
  res.json(item);
});

app.delete('/api/admin/menu/:id', checkAdmin, (req, res) => {
  const menu = readJSON(MENU_FILE);
  const item = menu.find(m => m.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Menu item nahi mila.' });

  if (item.image && item.image.startsWith('/uploads/')) {
    const oldPath = path.join(UPLOADS_DIR, path.basename(item.image));
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const updatedMenu = menu.filter(m => m.id !== parseInt(req.params.id));
  writeJSON(MENU_FILE, updatedMenu);
  res.json({ message: 'Item delete ho gaya.' });
});

app.post('/api/admin/menu/:id/image-upload', checkAdmin, (req, res) => {
  upload.single('image')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Koi image file nahi mili.' });
    }

    const menu = readJSON(MENU_FILE);
    const item = menu.find(m => m.id === parseInt(req.params.id));
    if (!item) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Menu item nahi mila.' });
    }

    if (item.image && item.image.startsWith('/uploads/')) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(item.image));
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    item.image = `/uploads/${req.file.filename}`;
    writeJSON(MENU_FILE, menu);
    res.json(item);
  });
});

app.post('/api/admin/menu', checkAdmin, (req, res) => {
  const menu = readJSON(MENU_FILE);
  const newId = menu.length ? Math.max(...menu.map(m => m.id)) + 1 : 1;
  const newItem = {
    id: newId,
    name: req.body.name || 'New Item',
    category: req.body.category || 'mains',
    price: parseFloat(req.body.price) || 0,
    description: req.body.description || '',
    emoji: req.body.emoji || '🍽️',
    image: req.body.image || '',
    available: req.body.available !== undefined ? !!req.body.available : true
  };
  menu.push(newItem);
  writeJSON(MENU_FILE, menu);
  res.status(201).json(newItem);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Chirp Restaurant server chal raha hai: http://localhost:${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});
