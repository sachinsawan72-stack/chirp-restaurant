// Chirp Restaurant - Backend Server (Express + MongoDB Atlas = permanent storage)
try { require('dotenv').config(); } catch (e) { /* dotenv optional hai local dev ke liye */ }

const express = require('express');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'chirp123'; // Render me environment variable se change karo
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI env variable set nahi hai. .env file check karo (local) ya Render Environment tab me add karo.');
  process.exit(1);
}

mongoose.connect(MONGODB_URI)
  .then(() => console.log('✅ MongoDB Atlas se connect ho gaya'))
  .catch(err => {
    console.error('❌ MongoDB connect nahi hua:', err.message);
    process.exit(1);
  });

// ---------- Schemas (permanent, DB me store hote hain) ----------
const menuItemSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true },
  name: String,
  category: String,
  price: Number,
  description: String,
  emoji: String,
  image: String,
  available: { type: Boolean, default: true }
});

const orderItemSchema = new mongoose.Schema({
  id: Number,
  name: String,
  price: Number,
  quantity: Number
}, { _id: false });

const orderSchema = new mongoose.Schema({
  id: { type: Number, unique: true, required: true },
  items: [orderItemSchema],
  total: Number,
  customerName: String,
  customerPhone: String,
  tableNumber: String,
  status: { type: String, default: 'received' },
  createdAt: { type: Date, default: Date.now }
});

const MenuItem = mongoose.model('MenuItem', menuItemSchema);
const Order = mongoose.model('Order', orderSchema);

// ---------- Uploads folder (image files) ----------
const UPLOADS_DIR = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

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

function checkAdmin(req, res, next) {
  const key = req.header('x-admin-key');
  if (key !== ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Admin key galat hai.' });
  }
  next();
}

// ---------- Public API ----------

app.get('/api/menu', async (req, res) => {
  const menu = await MenuItem.find().sort({ id: 1 }).lean();
  res.json(menu);
});

app.post('/api/orders', async (req, res) => {
  const { items, customerName, customerPhone, tableNumber } = req.body;

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Cart khali hai, kam se kam 1 item chahiye.' });
  }

  const menu = await MenuItem.find().lean();
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

  const order = await Order.create({
    id: Date.now(),
    items: orderItems,
    total: Math.round(total * 100) / 100,
    customerName: customerName || 'Guest',
    customerPhone: customerPhone || '',
    tableNumber: tableNumber || '',
    status: 'received',
    createdAt: new Date()
  });

  res.status(201).json({ message: 'Order successfully mil gaya!', order });
});

// ---------- Admin API (protected by x-admin-key header) ----------

app.get('/api/admin/orders', checkAdmin, async (req, res) => {
  const orders = await Order.find().sort({ id: -1 }).lean();
  res.json(orders);
});

app.patch('/api/admin/orders/:id', checkAdmin, async (req, res) => {
  const order = await Order.findOne({ id: parseInt(req.params.id) });
  if (!order) return res.status(404).json({ error: 'Order nahi mila.' });
  order.status = req.body.status || order.status;
  await order.save();
  res.json(order);
});

// Menu item update (naam, category, price, description, emoji, image, AVAILABLE)
app.patch('/api/admin/menu/:id', checkAdmin, async (req, res) => {
  const item = await MenuItem.findOne({ id: parseInt(req.params.id) });
  if (!item) return res.status(404).json({ error: 'Menu item nahi mila.' });

  if (typeof req.body.name === 'string' && req.body.name.trim()) item.name = req.body.name.trim();
  if (typeof req.body.category === 'string' && req.body.category.trim()) item.category = req.body.category.trim();
  if (typeof req.body.emoji === 'string' && req.body.emoji.trim()) item.emoji = req.body.emoji.trim();
  if (typeof req.body.image === 'string') item.image = req.body.image;
  if (req.body.price !== undefined && !isNaN(parseFloat(req.body.price))) item.price = parseFloat(req.body.price);
  if (typeof req.body.description === 'string') item.description = req.body.description;
  if (req.body.available !== undefined) item.available = !!req.body.available; // pehle yeh missing tha

  await item.save();
  res.json(item);
});

app.delete('/api/admin/menu/:id', checkAdmin, async (req, res) => {
  const item = await MenuItem.findOne({ id: parseInt(req.params.id) });
  if (!item) return res.status(404).json({ error: 'Menu item nahi mila.' });

  if (item.image && item.image.startsWith('/uploads/')) {
    const oldPath = path.join(__dirname, 'public', item.image);
    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
  }

  await MenuItem.deleteOne({ id: parseInt(req.params.id) });
  res.json({ message: 'Item delete ho gaya.' });
});

app.post('/api/admin/menu/:id/image-upload', checkAdmin, (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'Koi image file nahi mili.' });

    const item = await MenuItem.findOne({ id: parseInt(req.params.id) });
    if (!item) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: 'Menu item nahi mila.' });
    }

    if (item.image && item.image.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, 'public', item.image);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    item.image = `/uploads/${req.file.filename}`;
    await item.save();
    res.json(item);
  });
});

app.post('/api/admin/menu', checkAdmin, async (req, res) => {
  const lastItem = await MenuItem.findOne().sort({ id: -1 }).lean();
  const newId = lastItem ? lastItem.id + 1 : 1;

  const newItem = await MenuItem.create({
    id: newId,
    name: req.body.name || 'New Item',
    category: req.body.category || 'mains',
    price: parseFloat(req.body.price) || 0,
    description: req.body.description || '',
    emoji: req.body.emoji || '🍽️',
    image: req.body.image || '',
    available: req.body.available !== undefined ? !!req.body.available : true
  });

  res.status(201).json(newItem);
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`Chirp Restaurant server chal raha hai: http://localhost:${PORT}`);
});
