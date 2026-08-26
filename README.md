# 🛒 Amazon API Analysis — Mock E-Commerce Backend

> A reverse-engineering study of how Amazon's frontend talks to its backend, rebuilt as a working REST API in **zero-dependency Node.js**.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?style=flat-square&logo=node.js&logoColor=white)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen?style=flat-square)
![Vanilla JS](https://img.shields.io/badge/frontend-vanilla%20JS-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![No build step](https://img.shields.io/badge/build%20step-none-blue?style=flat-square)
![Endpoints](https://img.shields.io/badge/endpoints-11-orange?style=flat-square)

---

## What this is

I opened Amazon in Chrome DevTools, watched the Network tab while shopping, and worked out what the site's API surface looks like and how the client and server actually communicate. Then I rebuilt that contract as a real, running API.

The result is two files. `server.js` is a REST backend using **only Node's built-in modules** — no Express, no npm install, no build step. `index.html` is an Amazon-styled storefront that drives every endpoint through `fetch()` and prints each request to an on-page network log, so you can watch the frontend/backend conversation without leaving the page.

The full write-up of the analysis — Amazon's real endpoints, why it uses server-rendered HTML instead of a SPA, and the six interaction patterns that account for all of its traffic — is in **[ANALYSIS.md](ANALYSIS.md)**.

---

## Quick start

```bash
git clone https://github.com/<your-username>/amazon-api-analysis.git
cd amazon-api-analysis
node server.js
```

Then open **http://localhost:3000**.

That's it — there is no `npm install`, because there are no dependencies. Requires Node 18 or newer (check with `node --version`).

<details>
<summary><b>Running it on Windows</b></summary>

Open the project folder in File Explorer, click the address bar, type `cmd` and press Enter. That gives you a terminal already pointed at the folder. Then run `node server.js`. Press <kbd>Ctrl</kbd>+<kbd>C</kbd> to stop.

</details>

On startup you'll see:

```
  Mock Amazon API running at http://localhost:3000
  Open that URL, then press F12 -> Network -> Fetch/XHR

  Endpoints:
    GET    /api/products?category=books&sort=price_asc&page=1
    GET    /api/search?q=mouse
    GET    /api/products/:id
    GET    /api/cart
    POST   /api/cart            { productId, qty }
    PUT    /api/cart/:id        { qty }
    DELETE /api/cart/:id
    POST   /api/auth/login      { email, password }
    POST   /api/orders          { address, payment }
    GET    /api/orders
    GET    /api/deals

  Request log:
  GET    /api/products?page=1&size=8   -> 8 products
  POST   /api/cart   -> added #1
  PUT    /api/cart/1   -> qty of #1 set to 3
  POST   /api/orders   -> placed ORD-4021
```

---

## Features

**Full shopping flow** — browse, filter by category, sort by price or rating, search with autocomplete suggestions, view product details, add to cart, change quantities, remove items, sign in, place an order, then view order history.

**Server-authoritative cart.** Adding an item returns the *recalculated* subtotal, delivery charge and total from the server; the page re-renders from that response rather than trusting its own arithmetic. This mirrors why your real Amazon cart survives a browser restart and syncs to your phone — the browser holds a pointer to the cart, not the cart itself.

**Realistic error paths, not just happy paths.** Out-of-stock conflicts return `409`, malformed bodies return `400`, bad credentials return `401`, missing products return `404`. All four HTTP verbs are exercised.

**Built-in request inspector.** Every `fetch()` goes through one wrapper function, so each call is logged with its method, path, status and latency to a panel on the page *and* to the server terminal. You get three synchronised views of the same traffic: DevTools, the page, and stdout.

**Amazon-like response headers** — `Content-Type: application/json`, a `Cache-Control` directive that differs for public catalogue data versus per-user cart data, an `X-Amz-Rid`-style trace id, and permissive CORS.

---

## API reference

Base URL `http://localhost:3000`

| Method | Endpoint | Body / Query | Purpose |
|:---|:---|:---|:---|
| `GET` | `/api/products` | `?category=&sort=&page=&size=` | Paginated, filterable, sortable listing |
| `GET` | `/api/search` | `?q=` | Search results + autocomplete suggestions |
| `GET` | `/api/products/:id` | — | Product detail, discount %, delivery promise, similar items |
| `GET` | `/api/cart` | — | Cart with subtotal, delivery and total |
| `POST` | `/api/cart` | `{ productId, qty }` | Add to cart |
| `PUT` | `/api/cart/:id` | `{ qty }` | Update quantity |
| `DELETE` | `/api/cart/:id` | — | Remove line item |
| `POST` | `/api/auth/login` | `{ email, password }` | Sign in, returns a bearer token |
| `POST` | `/api/orders` | `{ address, payment }` | Place order, clears the cart |
| `GET` | `/api/orders` | — | Order history |
| `GET` | `/api/deals` | — | Items discounted over 40% |

`sort` accepts `price_asc`, `price_desc` or `rating`. `category` accepts `electronics`, `books`, `fashion` or `kitchen`.

### Example

```bash
curl -X POST http://localhost:3000/api/cart \
     -H "Content-Type: application/json" \
     -d '{"productId":1,"qty":2}'
```

```json
{
  "message": "Added to cart",
  "items": [
    { "productId": 1, "title": "boAt Rockerz 450 Bluetooth Headphones", "price": 1499, "qty": 2 }
  ],
  "subtotal": 2998,
  "delivery": 0,
  "total": 2998,
  "count": 1
}
```

Note that the response carries the recomputed totals — the client never calculates money.

---

## How the frontend talks to the backend

The entire client/server boundary is one function. Every feature on the page routes through it, which makes the interaction easy to reason about and to instrument:

```js
async function api(method, path, body) {
  const options = { method, headers: {} };
  if (body) {
    options.headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(body);
  }
  if (token) options.headers['Authorization'] = 'Bearer ' + token;

  const res  = await fetch(path, options);
  const data = await res.json();

  logLine(method, path, res.status, ...);   // mirrors DevTools
  return data;
}
```

Requests are **stateless** — identity travels in a header (a cookie, on the real site), so the server re-derives who you are on every call and never holds a session in memory. That is what lets Amazon put thousands of interchangeable servers behind a load balancer. Calls are **asynchronous**, so the page stays responsive while a request is in flight. The **URL identifies the resource, the method states the intent, and the status code reports the outcome** — the frontend branches on `res.status`, never on scraping response text.

[ANALYSIS.md](ANALYSIS.md) covers the rest: the 15 real Amazon endpoints observed in DevTools, why the site is server-rendered rather than a SPA, optimistic UI with server reconciliation, and how telemetry beacons dominate the request count.

---

## Try it in DevTools

Open the page with <kbd>F12</kbd> → **Network** → **Fetch/XHR**, then:

| Do this | Watch for |
|:---|:---|
| Load the page | Two requests fire **in parallel** — `/api/products` and `/api/cart` |
| Click **Add to Cart** | `POST` with `{"productId":1,"qty":1}` in **Payload**, recalculated totals in **Response** |
| Change a quantity | `PUT /api/cart/1` — the resource is identified by URL, the change by verb |
| Click **Delete** | `DELETE /api/cart/1` |
| Add the **Levi's jeans** | Red **`409`** — stock is 0, a deliberate conflict case |
| **Sign in**, then click anything | `Authorization: Bearer …` now appears in **Headers** |
| **Place your order** | `201` with a new order id, and the cart is empty afterwards |

---

## Verified behaviour

Every endpoint was tested with `curl` against the running server:

| Request | Status | Response |
|:---|:---:|:---|
| `GET /api/products?category=books&sort=price_asc` | `200` | 2 books, cheapest first |
| `GET /api/search?q=mouse` | `200` | 1 result + suggestion list |
| `GET /api/products/2` | `200` | iPhone 15, `"17% off"`, 2 similar items |
| `GET /api/products/999` | `404` | `{ "error": "ProductNotFound" }` |
| `POST /api/cart {"productId":1,"qty":2}` | `201` | subtotal 2998, free delivery |
| `POST /api/cart {"productId":5}` | `409` | `{ "error": "OutOfStock" }` |
| `POST /api/cart {}` | `400` | `{ "error": "productId is required" }` |
| `PUT /api/cart/1 {"qty":3}` | `200` | subtotal recalculated to 4497 |
| `DELETE /api/cart/1` | `200` | cart emptied |
| `POST /api/auth/login` valid | `200` | user object + token |
| `POST /api/auth/login` short password | `401` | `{ "error": "InvalidCredentials" }` |
| `POST /api/orders` with items | `201` | `ORD-4021`, Confirmed, cart cleared |
| `POST /api/orders` empty cart | `400` | `{ "error": "CartIsEmpty" }` |
| `GET /api/unknown` | `404` | `{ "error": "NotFound", "route": … }` |

---

## Project structure

```
.
├── server.js       # REST API — http/fs/url only, 11 endpoints        (307 lines)
├── index.html      # Storefront + fetch() layer + network log        (327 lines)
├── ANALYSIS.md     # The Amazon DevTools study and write-up
├── package.json    # Metadata and `npm start`; no dependencies
└── .gitignore
```

---

## Tech stack

**Backend** — Node.js core only: `http` for the server, `url` for parsing paths and query strings, `fs` and `path` for serving the page. No framework, so the routing, body parsing and JSON serialisation are all visible in the source instead of hidden behind middleware.

**Frontend** — Vanilla HTML, CSS and JavaScript with the Fetch API. No React, no bundler, no build step.

**Storage** — In-memory JavaScript arrays.

---

## Limitations

This is a teaching model of an API, not a production service, and it's worth being explicit about that:

- **State is in memory.** Restarting the server resets the cart and orders. A real service would use a database.
- **Auth is mocked.** Any password of six or more characters succeeds, and the "JWT" is base64 — it is not signed or verified. Never model real authentication on this.
- **One shared cart.** All visitors use a single `guest-session` cart; there is no per-user isolation.
- **CORS is wide open** (`*`) for demo convenience.
- **The catalogue is 8 hardcoded products.**

Amazon also changes its internal endpoint paths frequently, runs A/B experiments, and varies routes by marketplace — so the paths documented in ANALYSIS.md represent the *patterns* observed, not a stable public contract. Amazon's only documented public APIs are the Product Advertising API and the Selling Partner API.

---

## Educational context

Built as **Practical 5** for a Full Stack Development course. The learning objective was to analyse a production e-commerce site's API surface using browser developer tools, then demonstrate understanding by implementing an equivalent backend.

Not affiliated with, endorsed by, or connected to Amazon. Product names and the visual styling are used for educational illustration; all data is fabricated.
