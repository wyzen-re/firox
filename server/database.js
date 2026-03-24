const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

let db = null;
const DB_PATH = path.join(__dirname, '../../firox.db');

async function init() {
  const SQL = await initSqlJs();
  
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    role TEXT DEFAULT 'user',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    image TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    price REAL NOT NULL,
    original_price REAL,
    category_id INTEGER,
    stock INTEGER DEFAULT 0,
    image TEXT,
    images TEXT,
    sizes TEXT,
    colors TEXT,
    featured INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    order_number TEXT UNIQUE NOT NULL,
    status TEXT DEFAULT 'pending',
    total REAL NOT NULL,
    shipping_address TEXT,
    payment_method TEXT,
    payment_status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL,
    price REAL NOT NULL,
    size TEXT,
    color TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS cart (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    product_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    size TEXT,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    rating INTEGER NOT NULL,
    comment TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (product_id) REFERENCES products(id)
  )`);

  const catCount = db.exec('SELECT COUNT(*) as count FROM categories')[0]?.values[0][0] || 0;
  if (catCount === 0) seedData();
  save();
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

function getOne(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) { const row = stmt.getAsObject(); stmt.free(); return row; }
  stmt.free();
  return null;
}

function getAll(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results = [];
  while (stmt.step()) results.push(stmt.getAsObject());
  stmt.free();
  return results;
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
  return { lastInsertRowid: db.exec('SELECT last_insert_rowid()')[0]?.values[0][0] };
}

function seedData() {
  const categories = [
    ['Men', 'men', 'https://images.unsplash.com/photo-1552374196-c4e7ffc6e126?w=400'],
    ['Women', 'women', 'https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?w=400'],
    ['Kids', 'kids', 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?w=400'],
    ['Accessories', 'accessories', 'https://images.unsplash.com/photo-1523170335258-f5ed11844a49?w=400'],
    ['Shoes', 'shoes', 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400']
  ];

  categories.forEach(c => run('INSERT INTO categories (name, slug, image) VALUES (?, ?, ?)', c));

  const products = [
    ['Urban Denim Jacket', 'urban-denim-jacket', 'Premium wash denim jacket with modern fit and vintage wash', 89.99, 129.99, 1, 45, 'https://images.unsplash.com/photo-1551028719-00167b16eac5?w=400', '["S","M","L","XL"]', '["Blue","Black","Grey"]', 1],
    ['Classic Chinos', 'classic-chinos', 'Premium cotton chinos with perfect drape', 59.99, 79.99, 1, 80, 'https://images.unsplash.com/photo-1473966968600-fa801b869a1a?w=400', '["28","30","32","34","36"]', '["Navy","Khaki","Olive"]', 1],
    ['Essential Tee Pack', 'essential-tee-pack', 'Pack of 3 premium cotton crew neck tees', 39.99, 59.99, 1, 150, 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400', '["S","M","L","XL"]', '["White","Black","Grey"]', 1],
    ['Oversized Hoodie', 'oversized-hoodie', 'Heavyweight cotton hoodie with dropped shoulders', 79.99, 99.99, 1, 60, 'https://images.unsplash.com/photo-1556821840-3a63f95609a7?w=400', '["S","M","L","XL"]', '["Black","Grey","Navy"]', 1],
    ['Wool Blend Overcoat', 'wool-blend-overcoat', 'Elegant double-breasted wool coat', 199.99, 299.99, 2, 25, 'https://images.unsplash.com/photo-1539533018447-63fcce2678e3?w=400', '["S","M","L"]', '["Black","Camel","Grey"]', 1],
    ['Silk Midi Dress', 'silk-midi-dress', 'Flowing silk dress for special occasions', 149.99, 199.99, 2, 35, 'https://images.unsplash.com/photo-1595777457583-95e059d581b8?w=400', '["XS","S","M","L"]', '["Champagne","Black","Burgundy"]', 1],
    ['Leather Crossbody', 'leather-crossbody', 'Premium leather crossbody bag', 119.99, 169.99, 4, 40, 'https://images.unsplash.com/photo-1584917865442-de89df76afd3?w=400', '["One Size"]', '["Black","Tan","Burgundy"]', 1],
    ['Performance Sneakers', 'performance-sneakers', 'Lightweight cushioned running shoes', 129.99, 169.99, 5, 70, 'https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=400', '["7","8","9","10","11","12"]', '["White/Black","Black","Navy"]', 1],
    ['Kids Graphic Tee', 'kids-graphic-tee', 'Soft cotton graphic tee for kids', 24.99, 34.99, 3, 120, 'https://images.unsplash.com/photo-1519457431-44ccd64a579b?w=400', '["2-3Y","4-5Y","6-7Y","8-9Y"]', '["Blue","Pink","Green"]', 0],
    ['Leather Belt', 'leather-belt', 'Full-grain leather dress belt', 34.99, 49.99, 4, 100, 'https://images.unsplash.com/photo-1553062407-98eeb64c6a62?w=400', '["S","M","L","XL"]', '["Black","Brown"]', 0],
    ['Summer Maxi Dress', 'summer-maxi-dress', 'Breezy linen maxi dress', 79.99, 109.99, 2, 50, 'https://images.unsplash.com/photo-1572804013309-59a88b7e92f1?w=400', '["XS","S","M","L","XL"]', '["White","Floral","Sky Blue"]', 1],
    ['Oxford Button-Down', 'oxford-button-down', 'Crisp cotton oxford shirt', 44.99, 59.99, 1, 85, 'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400', '["S","M","L","XL","XXL"]', '["White","Light Blue","Pink"]', 1],
    ['Sports Dad Cap', 'sports-dad-cap', 'Classic structured dad cap', 24.99, 34.99, 4, 180, 'https://images.unsplash.com/photo-1588850561407-ed78c282e89b?w=400', '["One Size"]', '["Black","Navy","Khaki","White"]', 0],
    ['Aviator Sunglasses', 'aviator-sunglasses', 'Classic aviator metal frame sunglasses', 59.99, 89.99, 4, 60, 'https://images.unsplash.com/photo-1572635196237-14b3f281503f?w=400', '["One Size"]', '["Gold","Silver","Black"]', 1],
    ['Cashmere Scarf', 'cashmere-scarf', '100% pure cashmere scarf', 89.99, 129.99, 4, 35, 'https://images.unsplash.com/photo-1520903920243-00d872a2d1c9?w=400', '["One Size"]', '["Camel","Grey","Burgundy","Navy"]', 0],
    ['Platform Boots', 'platform-boots', 'Chunky platform Chelsea boots', 149.99, 199.99, 5, 30, 'https://images.unsplash.com/photo-1608256246200-53e635b5b65f?w=400', '["7","8","9","10","11"]', '["Black","Brown"]', 1]
  ];

  products.forEach(p => {
    run(`INSERT INTO products (name, slug, description, price, original_price, category_id, stock, image, sizes, colors, featured) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], p[8], p[9], p[10]]);
  });

  const adminPassword = bcrypt.hashSync('admin123', 10);
  run('INSERT INTO users (email, password, name, role) VALUES (?, ?, ?, ?)', ['admin@firox.com', adminPassword, 'Admin', 'admin']);

  console.log('FIROX database seeded with products');
}

module.exports = { init, getOne, getAll, run };
