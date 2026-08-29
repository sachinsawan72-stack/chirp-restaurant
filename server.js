// Chirp Restaurant - Backend Server (Express + JSON file storage)
const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'chirp123'; // Render me environment variable se change karo

const MENU_FILE = path.join(__dirname, 'data', 'menu.json');
const ORDERS_FILE = path.join(__dirname, 'data', 'orders.json');
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');

// Agar uploads folder nahi hai to bana do
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
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

// Agar orders.json nahi hai to bana do
if (!fs.existsSync(ORDERS_FILE)) {
  fs.writeFileSync(ORDERS_FILE, '[]');
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

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

// Menu ki poori list
app.get('/api/menu', (req, res) => {
  const menu = readJSON(MENU_FILE);
  res.json(menu);
});

// Naya order place karna
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

// Sab orders dekhna (kitchen/owner dashboard ke liye)
app.get('/api/admin/orders', checkAdmin, (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  res.json(orders.reverse());
});

// Order status update (received -> preparing -> ready -> completed)
app.patch('/api/admin/orders/:id', checkAdmin, (req, res) => {
  const orders = readJSON(ORDERS_FILE);
  const order = orders.find(o => o.id === parseInt(req.params.id));
  if (!order) return res.status(404).json({ error: 'Order nahi mila.' });
  order.status = req.body.status || order.status;
  writeJSON(ORDERS_FILE, orders);
  res.json(order);
});

// Menu item ke details update karna (naam, category, price, description, emoji, image URL)
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

  writeJSON(MENU_FILE, menu);
  res.json(item);
});

// Menu item delete karna
app.delete('/api/admin/menu/:id', checkAdmin, (req, res) => {
  const menu = readJSON(MENU_FILE);
  const item = menu.find(m => m.id === parseInt(req.params.id));
  if (!item) return res.status(404).json({ error: 'Menu item nahi mila.' });

  // Uploaded image bhi delete kar do agar hai
  if (item.image && item.image.startsWith('/uploads/')) {
    const oldPath = path.join(__dirname, 'public', item.image);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  const updatedMenu = menu.filter(m => m.id !== parseInt(req.params.id));
  writeJSON(MENU_FILE, updatedMenu);
  res.json({ message: 'Item delete ho gaya.' });
});

// Menu item ki image FILE upload karna (device se image select karke)
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
      fs.unlinkSync(req.file.path); // fazool file delete kar do
      return res.status(404).json({ error: 'Menu item nahi mila.' });
    }

    // Purani uploaded image ho to delete kar do (sirf apne uploads folder ki file, external URL ko chhedo mat)
    if (item.image && item.image.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, 'public', item.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    item.image = `/uploads/${req.file.filename}`;
    writeJSON(MENU_FILE, menu);
    res.json(item);
  });
});

// Naya menu item add karna
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
    image: req.body.image || ''
  };
  menu.push(newItem);
  writeJSON(MENU_FILE, menu);
  res.status(201).json(newItem);
});

// Health check (Render isko use kar sakta hai)
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Chirp Restaurant server chal raha hai: http://localhost:${PORT}`);
});
