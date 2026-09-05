require('dotenv').config();
const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');
const crypto = require('crypto');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = Number(process.env.PORT || 5000);
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'smart_vyapar'
};

let db;

async function initDatabase() {
  const bootstrap = await mysql.createConnection({
    host: DB_CONFIG.host,
    port: DB_CONFIG.port,
    user: DB_CONFIG.user,
    password: DB_CONFIG.password,
    ssl: {
        rejectUnauthorized: false             
    }
});
  await bootstrap.query(`CREATE DATABASE IF NOT EXISTS \`${DB_CONFIG.database}\``);
  await bootstrap.end();

  db = await mysql.createPool({
    ...DB_CONFIG,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    multipleStatements: true,
    ssl: {
        rejectUnauthorized: false
    }
});

  await db.query(`
    CREATE TABLE IF NOT EXISTS vendors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      phone VARCHAR(20) NOT NULL,
      email VARCHAR(150),
      password VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS shops (
      id INT AUTO_INCREMENT PRIMARY KEY,
      vendor_id INT NOT NULL,
      shop_name VARCHAR(150) NOT NULL,
      logo VARCHAR(500),
      location VARCHAR(255),
      contact VARCHAR(20),
      opening_time VARCHAR(20),
      closing_time VARCHAR(20),
      category VARCHAR(100),
      upi_id VARCHAR(150),
      qr_token VARCHAR(100) UNIQUE,
      is_published BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_shop_vendor FOREIGN KEY (vendor_id) REFERENCES vendors(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS products (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop_id INT NOT NULL,
      name VARCHAR(150) NOT NULL,
      description TEXT,
      price DECIMAL(10,2) NOT NULL DEFAULT 0,
      stock INT NOT NULL DEFAULT 0,
      category VARCHAR(100) DEFAULT 'General',
      emoji VARCHAR(20) DEFAULT '📦',
      image VARCHAR(500),
      low_stock_limit INT NOT NULL DEFAULT 5,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_product_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      shop_id INT NOT NULL,
      customer_name VARCHAR(100) NOT NULL,
      customer_phone VARCHAR(20) NOT NULL,
      customer_address TEXT,
      total_amount DECIMAL(10,2) NOT NULL,
      payment_method ENUM('upi','qr','cod') NOT NULL,
      payment_status ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
      order_status ENUM('new','accepted','preparing','ready','delivered') NOT NULL DEFAULT 'new',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_order_shop FOREIGN KEY (shop_id) REFERENCES shops(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      subtotal DECIMAL(10,2) NOT NULL,
      CONSTRAINT fk_item_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
      CONSTRAINT fk_item_product FOREIGN KEY (product_id) REFERENCES products(id)
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      payment_method ENUM('upi','qr','cod') NOT NULL,
      transaction_id VARCHAR(150),
      amount DECIMAL(10,2) NOT NULL,
      payment_status ENUM('pending','paid','failed') NOT NULL DEFAULT 'pending',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;

    CREATE TABLE IF NOT EXISTS stock_alerts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      current_stock INT NOT NULL,
      threshold INT NOT NULL,
      status ENUM('active','resolved') NOT NULL DEFAULT 'active',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT fk_alert_product FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
  `);

  // The database may already have been created from the supplied SQL file.
  // Add any columns needed by the current application without destroying data.
  const [emojiColumn] = await db.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'emoji'
  `, [DB_CONFIG.database]);
  if (Number(emojiColumn[0].count) === 0) {
    await db.query(`ALTER TABLE products ADD COLUMN emoji VARCHAR(20) DEFAULT '📦' AFTER category`);
  }

}

function shopBase(req) {
  return req.params.id;
}

async function getShop(id) {
  const [rows] = await db.query('SELECT * FROM shops WHERE id = ? OR qr_token = ?', [id, id]);
  return rows[0];
}

app.get('/api/health', async (req, res) => {
  try { await db.query('SELECT 1'); res.json({ ok: true, database: DB_CONFIG.database }); }
  catch (e) { res.status(500).json({ ok: false, message: e.message }); }
});

app.get('/api/shops', async (req, res) => {
  const [rows] = await db.query('SELECT * FROM shops ORDER BY id DESC');
  res.json(rows);
});

app.get('/api/shop/:id', async (req, res) => {
  const shop = await getShop(shopBase(req));
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  res.json(shop);
});

app.post('/api/shops', async (req, res) => {
  const b = req.body;
  if (!b.shop_name?.trim()) return res.status(400).json({ message: 'Shop name is required' });
  // The database may already have been created from the supplied SQL file.
  // Add any columns needed by the current application without destroying data.
  const [emojiColumn] = await db.query(`
    SELECT COUNT(*) AS count
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'emoji'
  `, [DB_CONFIG.database]);
  if (Number(emojiColumn[0].count) === 0) {
    await db.query(`ALTER TABLE products ADD COLUMN emoji VARCHAR(20) DEFAULT '📦' AFTER category`);
  }

 const [vendors] = await db.query(
  'SELECT id FROM vendors ORDER BY id LIMIT 1'
);

let vendorId = vendors[0]?.id;

if (!vendorId) {
  const [vendorResult] = await db.query(
    'INSERT INTO vendors (name, phone, email) VALUES (?, ?, ?)',
    [
      b.shop_name.trim() + ' Owner',
      b.contact || '0000000000',
      null
    ]
  );

  vendorId = vendorResult.insertId;
}
  const token = 'SHOP-' + crypto.randomBytes(5).toString('hex').toUpperCase();
  const [r] = await db.query(`INSERT INTO shops (vendor_id,shop_name,logo,location,contact,opening_time,closing_time,category,upi_id,qr_token,is_published) VALUES (?,?,?,?,?,?,?,?,?,?,TRUE)`, [vendorId, b.shop_name.trim(), b.logo || '🥭', b.location || '', b.contact || '', b.opening_time || '', b.closing_time || '', b.category || 'Grocery & Kirana', b.upi_id || '', token]);
  const shop = await getShop(r.insertId);
  res.status(201).json(shop);
});

app.patch('/api/shops/:id/publish', async (req, res) => {
  await db.query('UPDATE shops SET is_published=TRUE WHERE id=?', [req.params.id]);
  const shop = await getShop(req.params.id);
  if (!shop) return res.status(404).json({ message: 'Shop not found' });
  res.json(shop);
});

app.get('/api/products', async (req, res) => {
  const [rows] = await db.query(`SELECT id,shop_id,name,description,price,stock,category AS cat,emoji,image,low_stock_limit,created_at,updated_at FROM products WHERE shop_id = ? ORDER BY id`, [req.query.shop_id || 1]);
  res.json(rows);
});

app.post('/api/products', async (req, res) => {
  const b = req.body;
  if (!b.shop_id || !b.name) return res.status(400).json({ message: 'shop_id and name are required' });
  const [r] = await db.query('INSERT INTO products (shop_id,name,description,price,stock,category,emoji,image,low_stock_limit) VALUES (?,?,?,?,?,?,?,?,?)', [b.shop_id,b.name,b.description||'',Number(b.price)||0,Number(b.stock)||0,b.cat||b.category||'General',b.emoji||'📦',b.image||null,Number(b.low_stock_limit)||5]);
  const [rows] = await db.query('SELECT id,shop_id,name,description,price,stock,category AS cat,emoji,image,low_stock_limit FROM products WHERE id=?', [r.insertId]);
  res.status(201).json(rows[0]);
});

app.patch('/api/products/:id/stock', async (req, res) => {
  const change = Number(req.body.change || 0);
  await db.query('UPDATE products SET stock=GREATEST(stock+?,0) WHERE id=?', [change, req.params.id]);
  const [rows] = await db.query('SELECT id,shop_id,name,description,price,stock,category AS cat,emoji,image,low_stock_limit FROM products WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message: 'Product not found' });
  const p = rows[0];
  if (p.stock <= p.low_stock_limit) await db.query(`INSERT INTO stock_alerts (product_id,current_stock,threshold,status) VALUES (?,?,?,'active')`, [p.id,p.stock,p.low_stock_limit]);
  else await db.query(`UPDATE stock_alerts SET status='resolved' WHERE product_id=? AND status='active'`, [p.id]);
  res.json(p);
});

app.get('/api/orders', async (req, res) => {
  const [orders] = await db.query('SELECT * FROM orders WHERE shop_id=? ORDER BY created_at DESC', [req.query.shop_id || 1]);
  for (const o of orders) {
    const [items] = await db.query('SELECT oi.*, p.name, p.emoji FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?', [o.id]);
    o.items = items;
  }
  res.json(orders);
});

app.post('/api/orders', async (req, res) => {
  const b = req.body;
  if (!b.shop_id || !Array.isArray(b.items) || !b.items.length) return res.status(400).json({ message: 'Invalid order' });
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    let total = 0; const items = [];
    for (const i of b.items) {
      const [rows] = await conn.query('SELECT * FROM products WHERE id=? AND shop_id=? FOR UPDATE', [i.product_id,b.shop_id]);
      const p = rows[0]; const q = Math.max(1, Number(i.quantity || 1));
      if (!p) throw new Error('Product not found');
      if (p.stock < q) throw new Error(`Insufficient stock for ${p.name}`);
      const subtotal = Number(p.price) * q; total += subtotal;
      items.push({ product_id:p.id, quantity:q, price:Number(p.price), subtotal });
    }
    const paymentMethod = ['upi','qr','cod'].includes(b.payment_method) ? b.payment_method : 'upi';
    const paymentStatus = paymentMethod === 'cod' ? 'pending' : 'paid';
    const [orderResult] = await conn.query(`INSERT INTO orders (shop_id,customer_name,customer_phone,customer_address,total_amount,payment_method,payment_status,order_status) VALUES (?,?,?,?,?,?,?,'new')`, [b.shop_id,b.customer_name||'Guest',b.customer_phone||'',b.customer_address||'',total,paymentMethod,paymentStatus]);
    for (const i of items) {
      await conn.query('INSERT INTO order_items (order_id,product_id,quantity,price,subtotal) VALUES (?,?,?,?,?)', [orderResult.insertId,i.product_id,i.quantity,i.price,i.subtotal]);
      await conn.query('UPDATE products SET stock=stock-? WHERE id=?', [i.quantity,i.product_id]);
    }
    await conn.query('INSERT INTO payments (order_id,payment_method,amount,payment_status) VALUES (?,?,?,?)', [orderResult.insertId,paymentMethod,total,paymentStatus]);
    await conn.commit();
    const [orders] = await db.query('SELECT * FROM orders WHERE id=?', [orderResult.insertId]);
    const [orderItems] = await db.query('SELECT oi.*,p.name,p.emoji FROM order_items oi JOIN products p ON p.id=oi.product_id WHERE oi.order_id=?', [orderResult.insertId]);
    orders[0].items = orderItems;
    res.status(201).json(orders[0]);
  } catch (e) { await conn.rollback(); res.status(400).json({ message:e.message }); }
  finally { conn.release(); }
});

app.patch('/api/orders/:id/status', async (req, res) => {
  const allowed = ['new','accepted','preparing','ready','delivered'];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message:'Invalid status' });
  const [r] = await db.query('UPDATE orders SET order_status=? WHERE id=?', [req.body.status,req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ message:'Order not found' });
  const [rows] = await db.query('SELECT * FROM orders WHERE id=?', [req.params.id]);
  res.json(rows[0]);
});

app.patch('/api/orders/:id/payment', async (req, res) => {
  const status = ['pending','paid','failed'].includes(req.body.status) ? req.body.status : 'paid';
  await db.query('UPDATE orders SET payment_status=? WHERE id=?', [status,req.params.id]);
  await db.query('UPDATE payments SET payment_status=? WHERE order_id=?', [status,req.params.id]);
  const [rows] = await db.query('SELECT * FROM orders WHERE id=?', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ message:'Order not found' });
  res.json(rows[0]);
});

app.get('/api/dashboard/:shopId', async (req, res) => {
  const shopId = req.params.shopId;
  const [orders] = await db.query('SELECT * FROM orders WHERE shop_id=?', [shopId]);
  const paid = orders.filter(o=>o.payment_status==='paid');
  const today = new Date().toISOString().slice(0,10), month = new Date().toISOString().slice(0,7);
  const todaySales = paid.filter(o=>o.created_at.toISOString().slice(0,10)===today).reduce((s,o)=>s+Number(o.total_amount),0);
  const monthlySales = paid.filter(o=>o.created_at.toISOString().slice(0,7)===month).reduce((s,o)=>s+Number(o.total_amount),0);
  const [bestRows] = await db.query(`SELECT p.id,p.name,p.emoji,SUM(oi.quantity) units FROM order_items oi JOIN orders o ON o.id=oi.order_id JOIN products p ON p.id=oi.product_id WHERE o.shop_id=? AND o.payment_status='paid' GROUP BY p.id,p.name,p.emoji ORDER BY units DESC LIMIT 4`, [shopId]);
  const weekly=[]; for(let i=6;i>=0;i--){const d=new Date();d.setDate(d.getDate()-i);const key=d.toISOString().slice(0,10);weekly.push(paid.filter(o=>o.created_at.toISOString().slice(0,10)===key).reduce((s,o)=>s+Number(o.total_amount),0));}
  res.json({todaySales,totalOrders:orders.length,pendingOrders:orders.filter(o=>o.order_status!=='delivered').length,monthlySales,bestSellers:bestRows.map(x=>({product:x,units:x.units})),weekly});
});

app.get('/api/stock/:shopId', async (req,res)=>{const [rows]=await db.query('SELECT id,shop_id,name,stock,low_stock_limit,stock<=low_stock_limit AS low_stock FROM products WHERE shop_id=?',[req.params.shopId]);res.json(rows);});

app.get('/api/reports/:shopId', async (req,res)=>{
  const date=req.query.date || new Date().toISOString().slice(0,10);
  const [rows]=await db.query(`SELECT p.id,p.name,p.emoji,p.price,COALESCE(SUM(CASE WHEN DATE(o.created_at)=? AND o.payment_status='paid' AND o.order_status='delivered' THEN oi.quantity ELSE 0 END),0) units FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.shop_id=? WHERE p.shop_id=? GROUP BY p.id,p.name,p.emoji,p.price ORDER BY units DESC`,[date,req.params.shopId,req.params.shopId]);
  const clean=rows.map(r=>({...r,units:Number(r.units),revenue:Number(r.units)*Number(r.price)})).filter(r=>r.units>0);
  res.json({date,totalUnits:clean.reduce((s,r)=>s+r.units,0),revenue:clean.reduce((s,r)=>s+r.revenue,0),topProduct:clean[0]||null,rows:clean});
});

app.get('/api/reports/:shopId/csv', async (req,res)=>{
  const date=req.query.date || new Date().toISOString().slice(0,10);
  const [rows]=await db.query(`SELECT p.name,COALESCE(SUM(CASE WHEN DATE(o.created_at)=? AND o.payment_status='paid' AND o.order_status='delivered' THEN oi.quantity ELSE 0 END),0) units,p.price FROM products p LEFT JOIN order_items oi ON oi.product_id=p.id LEFT JOIN orders o ON o.id=oi.order_id AND o.shop_id=? WHERE p.shop_id=? GROUP BY p.id,p.name,p.price ORDER BY units DESC`,[date,req.params.shopId,req.params.shopId]);
  let csv='Product,Units Sold,Revenue (INR)\n'; for(const r of rows) csv+=`"${String(r.name).replaceAll('"','""')}",${Number(r.units)},${Number(r.units)*Number(r.price)}\n`;
  res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition',`attachment; filename="daily-report-${date}.csv"`); res.send(csv);
});

const frontend = path.join(__dirname,'public');
app.use(express.static(frontend));
app.get('/shop/:id', (req,res)=>res.sendFile(path.join(frontend,'index.html')));
app.get('*',(req,res)=>res.sendFile(path.join(frontend,'index.html')));

initDatabase().then(()=>app.listen(PORT,()=>console.log(`\nSmart Vyapar running at http://localhost:${PORT}\nMySQL database: ${DB_CONFIG.database}\n`))).catch(err=>{console.error('Startup failed:',err.message);process.exit(1)});
