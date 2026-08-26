/* =====================================================================
   PRACTICAL 5  -  Analysing Amazon's API endpoints
   ---------------------------------------------------------------------
   A mock "Amazon" backend written with ONLY Node.js built-in modules.
   No npm install is needed.

        node server.js        ->  http://localhost:3000

   Every route below mirrors a real request that Amazon's website fires.
   Open DevTools -> Network -> Fetch/XHR while using the page to watch
   the frontend talk to this backend.
   ===================================================================== */

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const PORT = 3000;

/* ---------------------------------------------------------------------
   1. IN-MEMORY "DATABASE"
   Amazon would read this from DynamoDB / a product catalogue service.
   Here a plain array is enough to demonstrate the API.
   ------------------------------------------------------------------ */
const products = [
  { id: 1, title: 'boAt Rockerz 450 Bluetooth Headphones', category: 'electronics', price: 1499, mrp: 3990, rating: 4.1, reviews: 88412, prime: true,  stock: 12 },
  { id: 2, title: 'Apple iPhone 15 (128 GB, Blue)',        category: 'electronics', price: 65999, mrp: 79900, rating: 4.6, reviews: 12045, prime: true,  stock: 4  },
  { id: 3, title: 'Atomic Habits - James Clear',           category: 'books',       price: 399,  mrp: 799,  rating: 4.7, reviews: 210334, prime: true,  stock: 60 },
  { id: 4, title: 'Milton Thermosteel Flask 1000 ml',      category: 'kitchen',     price: 949,  mrp: 1650, rating: 4.3, reviews: 34210, prime: false, stock: 25 },
  { id: 5, title: 'Levis Mens Slim Fit Jeans',             category: 'fashion',     price: 1799, mrp: 3499, rating: 4.0, reviews: 9120,  prime: true,  stock: 0  },
  { id: 6, title: 'Logitech M235 Wireless Mouse',          category: 'electronics', price: 745,  mrp: 1295, rating: 4.2, reviews: 55901, prime: true,  stock: 33 },
  { id: 7, title: 'Prestige Induction Cooktop 1900 W',     category: 'kitchen',     price: 2299, mrp: 3995, rating: 4.1, reviews: 18760, prime: false, stock: 9  },
  { id: 8, title: 'Rich Dad Poor Dad - Robert Kiyosaki',   category: 'books',       price: 289,  mrp: 550,  rating: 4.5, reviews: 141220, prime: true,  stock: 47 }
];

// Server-side cart, keyed by session. Amazon keeps this in a cart service.
const carts = { 'guest-session': [] };
const orders = [];               // placed orders
let orderCounter = 4021;         // fake order-id sequence

/* ---------------------------------------------------------------------
   2. SMALL HELPERS
   ------------------------------------------------------------------ */

// Send a JSON response, exactly like a REST API does.
function sendJSON(res, status, data) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': status === 200 ? 'public, max-age=30' : 'no-store',
    'X-Amz-Rid': 'RID' + Math.random().toString(36).slice(2, 10).toUpperCase()
  });
  res.end(body);
}

// Collect a POST/PUT body and parse it as JSON.
function readBody(req, callback) {
  let raw = '';
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try { callback(raw ? JSON.parse(raw) : {}); }
    catch (e) { callback(null); }
  });
}

// Log every hit so you can compare the terminal with the Network tab.
function log(req, note) {
  console.log(`  ${req.method.padEnd(6)} ${req.url}   ${note}`);
}

// Cart total, the way the checkout page recalculates it.
function cartSummary(items) {
  let subtotal = 0;
  items.forEach(i => { subtotal += i.price * i.qty; });
  const delivery = subtotal > 499 || subtotal === 0 ? 0 : 40;
  return { items, subtotal, delivery, total: subtotal + delivery, count: items.length };
}

/* ---------------------------------------------------------------------
   3. THE SERVER  -  one handler, routed by method + path
   ------------------------------------------------------------------ */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const route = parsed.pathname;
  const query = parsed.query;
  const method = req.method;
  const cart = carts['guest-session'];

  // ---- CORS, so the page can call the API from anywhere ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  /* ---------- A. Serve the frontend page ---------- */
  if (route === '/' || route === '/index.html') {
    log(req, '-> frontend page');
    const file = path.join(__dirname, 'index.html');
    return fs.readFile(file, (err, html) => {
      if (err) { res.writeHead(500); return res.end('index.html not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(html);
    });
  }

  /* ---------- B. GET /api/products ----------
     Real Amazon: /s?k=laptop&ref=nb_sb_noss  (listing + filters)
     Supports ?category= , ?sort= , ?page=                              */
  if (route === '/api/products' && method === 'GET') {
    let list = products.slice();

    if (query.category) list = list.filter(p => p.category === query.category);
    if (query.sort === 'price_asc')  list.sort((a, b) => a.price - b.price);
    if (query.sort === 'price_desc') list.sort((a, b) => b.price - a.price);
    if (query.sort === 'rating')     list.sort((a, b) => b.rating - a.rating);

    const page = Number(query.page) || 1;
    const size = Number(query.size) || 8;
    const paged = list.slice((page - 1) * size, page * size);

    log(req, `-> ${paged.length} products`);
    return sendJSON(res, 200, {
      page, size, total: list.length,
      totalPages: Math.ceil(list.length / size),
      products: paged
    });
  }

  /* ---------- C. GET /api/search?q= ----------
     Real Amazon: /api/2017/suggestions?prefix=...  (search autocomplete) */
  if (route === '/api/search' && method === 'GET') {
    const q = (query.q || '').toLowerCase().trim();
    const hits = q
      ? products.filter(p => p.title.toLowerCase().includes(q) ||
                             p.category.includes(q))
      : [];
    log(req, `-> query "${q}", ${hits.length} hits`);
    return sendJSON(res, 200, {
      query: q,
      suggestions: hits.map(p => p.title).slice(0, 5),
      results: hits
    });
  }

  /* ---------- D. GET /api/products/:id ----------
     Real Amazon: /dp/B0XXXXXXX  (product detail page)                  */
  if (route.startsWith('/api/products/') && method === 'GET') {
    const id = Number(route.split('/')[3]);
    const product = products.find(p => p.id === id);
    if (!product) {
      log(req, '-> 404 not found');
      return sendJSON(res, 404, { error: 'ProductNotFound', id });
    }
    log(req, `-> detail for #${id}`);
    return sendJSON(res, 200, {
      ...product,
      discount: Math.round((1 - product.price / product.mrp) * 100) + '% off',
      inStock: product.stock > 0,
      delivery: product.prime ? 'FREE delivery tomorrow' : 'Delivery in 3-4 days',
      similar: products.filter(p => p.category === product.category && p.id !== id)
                       .map(p => ({ id: p.id, title: p.title, price: p.price }))
    });
  }

  /* ---------- E. GET /api/cart ----------
     Real Amazon: /gp/cart/view.html  +  cart count XHR on every page    */
  if (route === '/api/cart' && method === 'GET') {
    log(req, `-> cart has ${cart.length} line items`);
    return sendJSON(res, 200, cartSummary(cart));
  }

  /* ---------- F. POST /api/cart ----------
     Real Amazon: /cart/add-to-cart  (the yellow "Add to Cart" button)   */
  if (route === '/api/cart' && method === 'POST') {
    return readBody(req, body => {
      if (!body || !body.productId) {
        log(req, '-> 400 bad body');
        return sendJSON(res, 400, { error: 'productId is required' });
      }
      const product = products.find(p => p.id === Number(body.productId));
      if (!product) return sendJSON(res, 404, { error: 'ProductNotFound' });
      if (product.stock === 0) {
        log(req, '-> 409 out of stock');
        return sendJSON(res, 409, { error: 'OutOfStock', title: product.title });
      }

      const line = cart.find(i => i.productId === product.id);
      if (line) line.qty += Number(body.qty) || 1;
      else cart.push({
        productId: product.id, title: product.title,
        price: product.price, qty: Number(body.qty) || 1
      });

      log(req, `-> added #${product.id}`);
      return sendJSON(res, 201, { message: 'Added to cart', ...cartSummary(cart) });
    });
  }

  /* ---------- G. PUT /api/cart/:id  (change quantity) ---------- */
  if (route.startsWith('/api/cart/') && method === 'PUT') {
    const id = Number(route.split('/')[3]);
    return readBody(req, body => {
      const line = cart.find(i => i.productId === id);
      if (!line) return sendJSON(res, 404, { error: 'NotInCart', id });
      line.qty = Number(body.qty) || 1;
      log(req, `-> qty of #${id} set to ${line.qty}`);
      return sendJSON(res, 200, { message: 'Quantity updated', ...cartSummary(cart) });
    });
  }

  /* ---------- H. DELETE /api/cart/:id  ("Delete" link) ---------- */
  if (route.startsWith('/api/cart/') && method === 'DELETE') {
    const id = Number(route.split('/')[3]);
    const index = cart.findIndex(i => i.productId === id);
    if (index === -1) return sendJSON(res, 404, { error: 'NotInCart', id });
    cart.splice(index, 1);
    log(req, `-> removed #${id}`);
    return sendJSON(res, 200, { message: 'Item removed', ...cartSummary(cart) });
  }

  /* ---------- I. POST /api/auth/login ----------
     Real Amazon: /ap/signin  ->  sets session cookie / returns token    */
  if (route === '/api/auth/login' && method === 'POST') {
    return readBody(req, body => {
      if (!body || !body.email || !body.password) {
        return sendJSON(res, 400, { error: 'email and password required' });
      }
      if (body.password.length < 6) {
        log(req, '-> 401 wrong password');
        return sendJSON(res, 401, { error: 'InvalidCredentials' });
      }
      log(req, `-> signed in ${body.email}`);
      return sendJSON(res, 200, {
        message: 'Signed in',
        user: { email: body.email, name: body.email.split('@')[0] },
        token: 'mock.jwt.' + Buffer.from(body.email).toString('base64')
      });
    });
  }

  /* ---------- J. POST /api/orders  (place order) ----------
     Real Amazon: /gp/buy/spc/handlers/place-order.html                  */
  if (route === '/api/orders' && method === 'POST') {
    return readBody(req, body => {
      if (cart.length === 0) {
        log(req, '-> 400 empty cart');
        return sendJSON(res, 400, { error: 'CartIsEmpty' });
      }
      const summary = cartSummary(cart.slice());
      const order = {
        orderId: 'ORD-' + (orderCounter++),
        placedAt: new Date().toISOString(),
        address: (body && body.address) || 'Ahmedabad, Gujarat 380015',
        payment: (body && body.payment) || 'UPI',
        status: 'Confirmed',
        arriving: 'Tomorrow by 9 PM',
        ...summary
      };
      orders.unshift(order);
      cart.length = 0;                       // cart is cleared after checkout
      log(req, `-> placed ${order.orderId}`);
      return sendJSON(res, 201, order);
    });
  }

  /* ---------- K. GET /api/orders  ("Your Orders" page) ---------- */
  if (route === '/api/orders' && method === 'GET') {
    log(req, `-> ${orders.length} past orders`);
    return sendJSON(res, 200, { count: orders.length, orders });
  }

  /* ---------- L. GET /api/deals  (Today's Deals carousel) ---------- */
  if (route === '/api/deals' && method === 'GET') {
    const deals = products
      .filter(p => p.price / p.mrp < 0.6)
      .map(p => ({ id: p.id, title: p.title, price: p.price, mrp: p.mrp,
                   off: Math.round((1 - p.price / p.mrp) * 100) + '%' }));
    log(req, `-> ${deals.length} deals`);
    return sendJSON(res, 200, { deals });
  }

  /* ---------- M. Nothing matched ---------- */
  log(req, '-> 404 unknown route');
  sendJSON(res, 404, { error: 'NotFound', route, method });
});

/* ---------------------------------------------------------------------
   4. START
   ------------------------------------------------------------------ */
server.listen(PORT, () => {
  console.log('\n  Mock Amazon API running at http://localhost:' + PORT);
  console.log('  Open that URL, then press F12 -> Network -> Fetch/XHR\n');
  console.log('  Endpoints:');
  console.log('    GET    /api/products?category=books&sort=price_asc&page=1');
  console.log('    GET    /api/search?q=mouse');
  console.log('    GET    /api/products/:id');
  console.log('    GET    /api/cart');
  console.log('    POST   /api/cart            { productId, qty }');
  console.log('    PUT    /api/cart/:id        { qty }');
  console.log('    DELETE /api/cart/:id');
  console.log('    POST   /api/auth/login      { email, password }');
  console.log('    POST   /api/orders          { address, payment }');
  console.log('    GET    /api/orders');
  console.log('    GET    /api/deals\n');
  console.log('  Request log:');
});
