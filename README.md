# Practical 5 — Analysing the API endpoints of an E-commerce site (Amazon)

**Aim:** Study the Amazon website/app, work out which API endpoints it uses and what each one is for, describe how its frontend communicates with its backend, and then build a small working Node.js version of that API to demonstrate the same request/response behaviour.

---

## How to run

No `npm install` is required — the server uses only Node's built-in modules.

```
cd "practical 5"
node server.js
```

Then open **http://localhost:3000**, press **F12**, and select **Network → Fetch/XHR**. Click around the page and every request the frontend makes will appear there, along with its method, status code, timing, payload and response. The same requests are mirrored in the terminal and in the black "Network activity" panel on the page itself, so the three views can be compared side by side.

---

## Part A — Analysis of the real Amazon site

### How the architecture actually works

The first thing that becomes clear from the Network tab is that Amazon is **not** a single-page application. The main pages — home, search results, product detail, cart, checkout — arrive as **server-rendered HTML documents** on a full page navigation. If you filter the Network tab by `Doc`, you see one HTML response of a few hundred kilobytes; the products are already inside that HTML rather than being fetched as JSON afterwards.

Amazon does this deliberately. Search-engine crawlers can read the product data immediately, and the first meaningful paint does not have to wait for JavaScript to download, execute and then make a second round trip. For a catalogue business where a few hundred milliseconds of latency measurably changes conversion, that trade-off matters.

JSON APIs are then layered on top for everything that must happen **without losing the current page**. Search autocomplete, add-to-cart, quantity changes, the delivery-pincode selector, review pagination and the lazily-loaded "Customers also bought" carousels are all XHR/fetch calls returning JSON or HTML fragments. So the practical model is **server-rendered pages for navigation, JSON APIs for interaction** — a hybrid rather than a pure REST + SPA design.

A third category dominates the request count: **telemetry**. A large share of the entries in the Network tab are not features at all but analytics and performance beacons fired to hosts like `unagi.amazon.in` and `fls-na.amazon.com`, plus a page-timing beacon (`/rd/uedata`) sent after load. Static assets and every product image come from a separate CDN domain (`m.media-amazon.com`), which keeps cookies off image requests and lets them be cached aggressively at the edge.

> **Note:** the exact paths below are what is typically visible in DevTools; Amazon changes internal endpoints frequently, runs A/B experiments and varies routes by marketplace, so treat these as representative of the *pattern* rather than a fixed public contract. Amazon has no public REST API for browsing its retail catalogue — the documented ones are the Product Advertising API and Selling Partner API.

### Endpoints observed, and what each is for

| # | Endpoint (typical) | Method | Returns | What it is used for |
|---|---|---|---|---|
| 1 | `/` | GET | HTML | Homepage shell with banners and recommendation rows |
| 2 | `/s?k=<query>&ref=nb_sb_noss` | GET | HTML | Search results listing. `k` = keywords; extra params carry filters, sort and page |
| 3 | `completion.amazon.com/api/2017/suggestions?prefix=<text>&alias=aps` | GET | JSON | Search autocomplete. Fires on nearly every keystroke, debounced |
| 4 | `/dp/<ASIN>` or `/gp/product/<ASIN>` | GET | HTML | Product detail page. The ASIN is Amazon's product primary key |
| 5 | `/gp/product/ajax/ref=...` | GET | HTML fragment | Lazily loads variant/offer blocks after the main page paints |
| 6 | `/cart/add-to-cart` (also seen as `/gp/add-to-cart/json`) | POST | JSON | The "Add to Cart" button. Sends ASIN + quantity + session/CSRF token |
| 7 | `/gp/cart/view.html` | GET | HTML | Full cart page |
| 8 | `/cart/ajax-update` | POST | JSON | Quantity change and "Delete" links in the cart; returns the recalculated subtotal |
| 9 | `/portal-migration/hz/glow/get-rendered-toaster` | GET | HTML fragment | "Deliver to" pincode selector — re-renders the delivery promise |
| 10 | `/ap/signin` | POST | Redirect + `Set-Cookie` | Sign-in. Establishes the session cookie the rest of the site relies on |
| 11 | `/gp/buy/spc/handlers/display.html` | GET | HTML | Checkout pipeline (address → payment → review) |
| 12 | `/gp/buy/spc/handlers/place-order.html` | POST | Redirect | Places the order. Idempotency-protected so a double click cannot double-charge |
| 13 | `/your-orders/orders` | GET | HTML | Order history |
| 14 | `/gp/css/order-history/.../trackPackage` | GET | JSON/HTML | Shipment tracking status |
| 15 | `unagi.amazon.in/1/events/...`, `/rd/uedata?...` | GET/POST | 204 / 1×1 pixel | Clickstream analytics and page-performance beacons |

### How the frontend interacts with the backend

Reading the request/response pairs, six patterns account for essentially all of the traffic.

**Requests are stateless, identity travels in a cookie.** Every JSON call carries a `session-id` and `ubid-*` cookie set at sign-in. The backend does not remember the previous request; it re-derives who you are from the cookie each time. This is what allows Amazon to put thousands of interchangeable web servers behind a load balancer — any one of them can serve any request.

**The cart lives on the server, not in the browser.** Adding an item POSTs to the backend and the response contains the *authoritative* recalculated cart. The page then re-renders from that response rather than from its own local guess. This is why your cart survives closing the browser and appears on your phone: the browser holds a pointer to the cart, not the cart itself.

**HTTP verbs and status codes carry the meaning.** Reads are `GET`, creates are `POST`. `200` is a successful read, `201` a created resource, `400` a malformed request, `401` bad credentials, `404` a missing product, `409` a conflict such as an item going out of stock between page load and checkout. The frontend branches on the status code, not on scraping the response text.

**Calls are asynchronous and non-blocking.** `fetch()` returns a promise, so the page stays interactive while the request is in flight. This is also why the UI shows a spinner on the button and disables it — the response may take 200 ms and the user must not be able to click twice.

**Optimistic UI with server reconciliation.** The cart-count badge in the header increments the instant you click, before the server has replied. If the POST then fails — say the item is out of stock — the count is rolled back from the server's response. It feels instant while remaining correct.

**Big collections are paginated and cached.** Listings are requested a page at a time with a page/offset parameter, because returning millions of matches is impossible. Responses carry `Cache-Control` so the browser and CDN can reuse them; cart and order responses are marked `no-store` because they are per-user and must never be cached.

---

## Part B — The Node.js implementation

`server.js` reproduces the analysis above as a real, running API using only `http`, `fs`, `path` and `url`. `index.html` is the frontend, and it reaches the backend through exactly one wrapper function around `fetch()` — so there is a single place in the code where the two halves meet.

### Endpoints implemented

| Method | Endpoint | Purpose | Mirrors on Amazon |
|---|---|---|---|
| GET | `/api/products?category=&sort=&page=&size=` | Paginated, filterable, sortable listing | `/s?k=…` |
| GET | `/api/search?q=` | Search + autocomplete suggestions | `/api/2017/suggestions` |
| GET | `/api/products/:id` | Product detail, discount, delivery promise, similar items | `/dp/<ASIN>` |
| GET | `/api/cart` | Read cart with subtotal, delivery and total | cart-count XHR |
| POST | `/api/cart` | Add to cart — `{ productId, qty }` | `/cart/add-to-cart` |
| PUT | `/api/cart/:id` | Change quantity — `{ qty }` | `/cart/ajax-update` |
| DELETE | `/api/cart/:id` | Remove a line item | cart "Delete" link |
| POST | `/api/auth/login` | Sign in, returns a mock bearer token | `/ap/signin` |
| POST | `/api/orders` | Place order, clears the cart | `place-order.html` |
| GET | `/api/orders` | Order history | `/your-orders/orders` |
| GET | `/api/deals` | Items discounted more than 40% | Today's Deals |

### Behaviour verified

Each row below was tested with `curl` against the running server.

| Request | Status | Response |
|---|---|---|
| `GET /api/products?category=books&sort=price_asc` | 200 | 2 books, cheapest first |
| `GET /api/search?q=mouse` | 200 | 1 result + suggestion list |
| `GET /api/products/2` | 200 | iPhone 15, `"17% off"`, in stock, 2 similar items |
| `GET /api/products/999` | **404** | `{ "error": "ProductNotFound" }` |
| `POST /api/cart {"productId":1,"qty":2}` | **201** | subtotal 2998, free delivery |
| `POST /api/cart {"productId":5}` | **409** | `{ "error": "OutOfStock" }` — stock is 0 |
| `POST /api/cart {}` | **400** | `{ "error": "productId is required" }` |
| `PUT /api/cart/1 {"qty":3}` | 200 | subtotal recalculated to 4497 |
| `DELETE /api/cart/1` | 200 | cart emptied |
| `POST /api/auth/login` (6+ char password) | 200 | user object + token |
| `POST /api/auth/login` (short password) | **401** | `{ "error": "InvalidCredentials" }` |
| `POST /api/orders` (cart has items) | **201** | `ORD-4021`, status Confirmed, cart cleared |
| `POST /api/orders` (empty cart) | **400** | `{ "error": "CartIsEmpty" }` |
| `GET /api/unknown` | **404** | `{ "error": "NotFound", "route": … }` |

Sample response headers, showing the JSON content type, the cache directive and a request-id header of the kind Amazon uses for tracing:

```
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: public, max-age=30
X-Amz-Rid: RIDHCYYCIOS
Access-Control-Allow-Origin: *
```

### What to point out in the Network tab during a viva

Opening the page fires two requests in parallel (`/api/products` and `/api/cart`) — the same parallel-load behaviour as Amazon's homepage. Clicking **Add to Cart** shows a `POST` whose **Payload** tab contains `{"productId":1,"qty":1}` and whose **Response** tab contains the server-recalculated total, which demonstrates that the cart is authoritative on the server. Changing a quantity shows `PUT`, and **Delete** shows `DELETE`, so all four verbs are visible in one session. Adding the Levi's jeans returns a red `409`, which is the out-of-stock conflict case. Signing in first and then clicking anything shows an `Authorization: Bearer …` header appearing on subsequent requests in the **Headers** tab. Placing an order returns `201` with a new order id, and the following `GET /api/cart` shows the cart is now empty — the server-side state change persisted.

---

## Conclusion

Amazon uses a hybrid architecture: server-rendered HTML for page navigation, which keeps first paint fast and the catalogue crawlable, with JSON endpoints layered on for every interaction that must not reload the page. The frontend and backend are decoupled and communicate over stateless HTTP, where the URL identifies the resource, the method states the intent, the status code reports the outcome and JSON carries the data. Authoritative state — cart, session, orders, stock — is held on the server, and the browser is treated as a fast but untrusted view of it. The Node.js server in this folder reproduces that contract on a small scale, with all eleven endpoints and all six status-code paths verified end to end.
