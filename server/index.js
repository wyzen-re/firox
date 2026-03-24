const express = require('express');
const cors = require('cors');
const path = require('path');
const { init: initDB, getOne, getAll, run } = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'firox-secret-key-2024';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

let dbReady = false;

async function startServer() {
  await initDB();
  dbReady = true;
  app.listen(PORT, () => {
    console.log(`FIROX Fashion Store running at http://localhost:${PORT}`);
  });
}

function generateOrderNumber() {
  return 'FRO-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function generateSessionId(req) {
  return req.headers['x-session-id'] || req.body.sessionId || 'default';
}

function authenticate(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) { req.user = null; return next(); }
  try { const decoded = jwt.verify(token, JWT_SECRET); req.user = decoded; } catch (e) { req.user = null; }
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
  next();
}

// Categories
app.get('/api/categories', (req, res) => {
  const categories = getAll('SELECT * FROM categories ORDER BY name');
  res.json(categories);
});

// Products
app.get('/api/products', (req, res) => {
  const { category, search, featured, limit = 50, offset = 0, sort = 'newest' } = req.query;
  let query = 'SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1';
  const params = [];

  if (category) { query += ' AND c.slug = ?'; params.push(category); }
  if (search) { query += ' AND (p.name LIKE ? OR p.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (featured === 'true') { query += ' AND p.featured = 1'; }

  switch(sort) {
    case 'price-low': query += ' ORDER BY p.price ASC'; break;
    case 'price-high': query += ' ORDER BY p.price DESC'; break;
    case 'popular': query += ' ORDER BY p.featured DESC, p.created_at DESC'; break;
    default: query += ' ORDER BY p.created_at DESC';
  }

  query += ' LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));

  const products = getAll(query, params);
  res.json(products);
});

app.get('/api/products/:slug', (req, res) => {
  const product = getOne(`
    SELECT p.*, c.name as category_name,
    (SELECT AVG(rating) FROM reviews WHERE product_id = p.id) as avg_rating,
    (SELECT COUNT(*) FROM reviews WHERE product_id = p.id) as review_count
    FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.slug = ?
  `, [req.params.slug]);

  if (!product) return res.status(404).json({ error: 'Product not found' });

  product.images = product.images ? JSON.parse(product.images) : [];
  product.sizes = product.sizes ? JSON.parse(product.sizes) : [];
  product.colors = product.colors ? JSON.parse(product.colors) : [];

  const reviews = getAll(`
    SELECT r.*, u.name as user_name FROM reviews r 
    JOIN users u ON r.user_id = u.id WHERE r.product_id = ? ORDER BY r.created_at DESC LIMIT 10
  `, [product.id]);

  res.json({ product, reviews });
});

// Cart
app.get('/api/cart', (req, res) => {
  const sessionId = generateSessionId(req);
  const cart = getAll(`
    SELECT cart.*, p.name, p.price, p.image, p.stock, p.slug
    FROM cart JOIN products p ON cart.product_id = p.id WHERE cart.session_id = ?
  `, [sessionId]);
  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  res.json({ cart, total });
});

app.post('/api/cart', (req, res) => {
  const sessionId = generateSessionId(req);
  const { productId, quantity = 1, size, color } = req.body;

  const existing = getOne(`
    SELECT * FROM cart WHERE session_id = ? AND product_id = ? AND size = ? AND color = ?
  `, [sessionId, productId, size || null, color || null]);

  if (existing) { run('UPDATE cart SET quantity = quantity + ? WHERE id = ?', [quantity, existing.id]); }
  else { run('INSERT INTO cart (session_id, product_id, quantity, size, color) VALUES (?, ?, ?, ?, ?)', [sessionId, productId, quantity, size || null, color || null]); }
  res.json({ success: true });
});

app.put('/api/cart/:id', (req, res) => {
  const { quantity } = req.body;
  run('UPDATE cart SET quantity = ? WHERE id = ?', [quantity, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/cart/:id', (req, res) => {
  run('DELETE FROM cart WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/cart', (req, res) => {
  const sessionId = generateSessionId(req);
  run('DELETE FROM cart WHERE session_id = ?', [sessionId]);
  res.json({ success: true });
});

// Auth
app.post('/api/auth/register', async (req, res) => {
  const { email, password, name } = req.body;
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    const result = run('INSERT INTO users (email, password, name) VALUES (?, ?, ?)', [email, hashedPassword, name]);
    const token = jwt.sign({ id: result.lastInsertRowid, email, name, role: 'user' }, JWT_SECRET);
    res.json({ token, user: { id: result.lastInsertRowid, email, name, role: 'user' } });
  } catch (e) { res.status(400).json({ error: 'Email already exists' }); }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = getOne('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ id: user.id, email: user.email, name: user.name, role: user.role }, JWT_SECRET);
  res.json({ token, user: { id: user.id, email: user.email, name: user.name, role: user.role } });
});

app.get('/api/auth/me', authenticate, (req, res) => {
  if (!req.user) return res.json({ user: null });
  const user = getOne('SELECT id, email, name, phone, address, role FROM users WHERE id = ?', [req.user.id]);
  res.json({ user });
});

// Orders
app.post('/api/orders', requireAuth, (req, res) => {
  const { shippingAddress, paymentMethod, sessionId } = req.body;
  const cart = getAll('SELECT cart.*, p.price FROM cart JOIN products p ON cart.product_id = p.id WHERE cart.session_id = ?', [sessionId || generateSessionId(req)]);
  if (cart.length === 0) return res.status(400).json({ error: 'Cart is empty' });

  const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const orderNumber = generateOrderNumber();
  const orderResult = run(`INSERT INTO orders (user_id, order_number, total, shipping_address, payment_method, status) VALUES (?, ?, ?, ?, ?, ?)`, [req.user.id, orderNumber, total, shippingAddress, paymentMethod, 'pending']);
  const orderId = orderResult.lastInsertRowid;

  cart.forEach(item => {
    run('INSERT INTO order_items (order_id, product_id, quantity, price, size, color) VALUES (?, ?, ?, ?, ?, ?)', [orderId, item.product_id, item.quantity, item.price, item.size, item.color]);
    run('UPDATE products SET stock = stock - ? WHERE id = ?', [item.quantity, item.product_id]);
  });

  run('DELETE FROM cart WHERE session_id = ?', [sessionId || generateSessionId(req)]);
  res.json({ orderId, orderNumber, success: true });
});

app.get('/api/orders', requireAuth, (req, res) => {
  let orders;
  if (req.user.role === 'admin') {
    orders = getAll(`SELECT o.*, u.name as user_name, u.email as user_email FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC`);
  } else {
    orders = getAll('SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC', [req.user.id]);
  }
  orders.forEach(order => { order.items = getAll(`SELECT oi.*, p.name, p.image FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`, [order.id]); });
  res.json(orders);
});

app.get('/api/orders/:id', requireAuth, (req, res) => {
  const order = getOne('SELECT * FROM orders WHERE id = ? AND (user_id = ? OR ? = "admin")', [req.params.id, req.user.id, req.user.role]);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  order.items = getAll(`SELECT oi.*, p.name, p.image FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = ?`, [order.id]);
  res.json(order);
});

// Reviews
app.post('/api/reviews', requireAuth, (req, res) => {
  const { productId, rating, comment } = req.body;
  run('INSERT INTO reviews (user_id, product_id, rating, comment) VALUES (?, ?, ?, ?)', [req.user.id, productId, rating, comment]);
  res.json({ success: true });
});

app.get('/api/reviews', (req, res) => {
  const reviews = getAll('SELECT r.*, u.name as user_name, p.name as product_name FROM reviews r JOIN users u ON r.user_id = u.id JOIN products p ON r.product_id = p.id ORDER BY r.created_at DESC LIMIT 50');
  res.json(reviews);
});

// Admin
app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalOrders = getOne('SELECT COUNT(*) as count FROM orders')?.count || 0;
  const totalRevenue = getOne('SELECT SUM(total) as total FROM orders WHERE payment_status = "paid"')?.total || 0;
  const totalProducts = getOne('SELECT COUNT(*) as count FROM products')?.count || 0;
  const totalUsers = getOne('SELECT COUNT(*) as count FROM users')?.count || 0;
  const lowStock = getOne('SELECT COUNT(*) as count FROM products WHERE stock < 10')?.count || 0;
  const recentOrders = getAll(`SELECT o.*, u.name as user_name FROM orders o JOIN users u ON o.user_id = u.id ORDER BY o.created_at DESC LIMIT 10`);
  
  const ordersByStatus = getAll('SELECT status, COUNT(*) as count FROM orders GROUP BY status');
  const ordersByDate = getAll("SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total) as revenue FROM orders WHERE created_at >= DATE('now', '-30 days') GROUP BY DATE(created_at) ORDER BY date");

  res.json({ totalOrders, totalRevenue, totalProducts, totalUsers, lowStock, recentOrders, ordersByStatus, ordersByDate });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = getAll('SELECT id, email, name, role, created_at FROM users ORDER BY created_at DESC');
  res.json(users);
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const { role } = req.body;
  run('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  res.json({ success: true });
});

app.put('/api/admin/orders/:id', requireAdmin, (req, res) => {
  const { status } = req.body;
  run('UPDATE orders SET status = ? WHERE id = ?', [status, req.params.id]);
  res.json({ success: true });
});

app.post('/api/admin/products', requireAdmin, (req, res) => {
  const { name, slug, description, price, originalPrice, categoryId, stock, image, sizes, colors, featured } = req.body;
  try {
    const result = run(`INSERT INTO products (name, slug, description, price, original_price, category_id, stock, image, sizes, colors, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, 
      [name, slug, description, price, originalPrice, categoryId, stock, image, JSON.stringify(sizes), JSON.stringify(colors), featured ? 1 : 0]);
    res.json({ success: true, id: result.lastInsertRowid });
  } catch (e) { res.status(400).json({ error: 'Slug already exists or invalid data' }); }
});

app.put('/api/admin/products/:id', requireAdmin, (req, res) => {
  const { name, description, price, originalPrice, stock, featured } = req.body;
  run('UPDATE products SET name = ?, description = ?, price = ?, original_price = ?, stock = ?, featured = ? WHERE id = ?', [name, description, price, originalPrice, stock, featured ? 1 : 0, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/products/:id', requireAdmin, (req, res) => {
  run('DELETE FROM products WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/reviews/:id', requireAdmin, (req, res) => {
  run('DELETE FROM reviews WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

app.get('*', (req, res) => { res.sendFile(path.join(__dirname, '../public/index.html')); });

startServer();
