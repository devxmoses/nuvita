<div align="center">

# Nuvita

### A multi-vendor marketplace for food, beverages, wellness products and equipment — for people, pets and livestock

![NestJS](https://img.shields.io/badge/NestJS-11-E0234E?style=flat-square&logo=nestjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js&logoColor=white)
![Prisma](https://img.shields.io/badge/Prisma-7-2D3748?style=flat-square&logo=prisma&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?style=flat-square&logo=postgresql&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white)
![Stripe](https://img.shields.io/badge/Stripe-Payments-635BFF?style=flat-square&logo=stripe&logoColor=white)
![Tests](https://img.shields.io/badge/tests-340%20unit%20%2B%2096%20e2e-success?style=flat-square)

`JWT rotation` · `RBAC` · `Persisted cart` · `Per-vendor fulfilment` · `Delivery zones` · `Stripe webhooks` · `Swagger`

**Work in progress.** Everything below is marked ✅ built or 🚧 planned.

</div>

---

## About

Nuvita is a multi-vendor commerce platform for nutrition and wellness — food,
beverages, supplements and the equipment that goes with them — serving both human
and animal customers across pets and livestock.

Vendors run their own storefronts, catalogue, variants, inventory and delivery
zones. Customers build a server-side cart that spans vendors and check out once.
The API splits that cart into one **`VendorOrder`** per vendor, prices each vendor's
delivery against the chosen address, decrements stock atomically and freezes
line-item and address snapshots so history never changes underneath them. Payment
runs through Stripe PaymentIntents behind a signature-verified webhook.

The product taxonomy keeps two questions apart. `Category` says what a thing **is**
— Dry Food, Supplements, Beverages — and is a self-referential tree. `segments` and
`species` say who it is **for**. That separation is the design decision this schema
is built around; see **Design notes**.

The API is the part that exists today. Background jobs, media uploads, realtime
updates and the web client are next.

---

## Status at a glance

| Area | State |
|---|---|
| REST API — 14 NestJS domain modules | ✅ built |
| JWT auth, refresh rotation, reuse detection | ✅ built |
| RBAC + per-resource ownership guards | ✅ built |
| Persisted cart → atomic checkout → cancellation with restock | ✅ built |
| Stripe PaymentIntents + idempotent webhook | ✅ built |
| Category tree, reviews gated on delivered purchase | ✅ built |
| Admin analytics | ✅ built |
| Rate limiting, global exception mapping, OpenAPI docs | ✅ built |
| `/api/v1` global prefix, `/health` excluded | ✅ built |
| Pagination, sorting and filtering on public listings | ✅ built |
| Segment and species faceting, with a segment hierarchy | ✅ built |
| Vendor-suggested species with admin approval and merge | ✅ built |
| Recursive category filtering — a parent includes its subtree | ✅ built |
| Free-text product search | ✅ built |
| Categories scoped to segments, validated against products | ✅ built |
| **`ProductVariant`** — price and stock per variant | ✅ built |
| **`Address`** — saved addresses, exactly one default | ✅ built |
| **`DeliveryZone`** — vendor-scoped, most-specific-wins pricing | ✅ built |
| **`VendorOrder`** — per-vendor order splitting and fulfilment | ✅ built |
| Vendor approval flow, with an admin review queue | ✅ built |
| Test suite — 340 unit, 96 end-to-end | ✅ built |
| Redis + BullMQ background jobs | 🚧 next |
| S3 / Cloudinary uploads | 🚧 next |
| WebSocket order updates + `Notification` | 🚧 next |
| Stripe Connect vendor payouts | 🚧 planned |
| Next.js 15 web client | 🚧 planned |

---

## Roles

| Role | Can |
|---|---|
| **Customer** | ✅ browse vendors, products, categories · search and filter · manage a cart across vendors and variants · save addresses · check out · cancel while `PENDING` · review delivered purchases · 🚧 realtime order tracking |
| **Vendor** | ✅ create storefronts · manage own products, variants and stock · set delivery zones · read and advance own `VendorOrder`s · 🚧 Stripe Connect payouts |
| **Admin** | ✅ manage categories · approve and revoke vendors · approve, correct and merge species · move any order's status · platform analytics · 🚧 disputes |

Roles are boolean flags on `User` (`isVendor`, `isAdmin`) carried in the access token,
so guards authorize without a database round trip.

Creating a vendor flips `isVendor` on the owner inside the same transaction, but a new
vendor is **`isApproved: false`** and invisible: it is absent from `GET /vendors` and
its products are absent from `GET /products` until an admin approves it. Approval is
idempotent, and revoking it hides the storefront again without deleting anything.

---

## Target architecture

```
┌──────────────────────────────────────────────────────────────┐
│        🚧 Next.js 15 — App Router (SSR + RSC)                │
│    (customer) │ (vendor) │ (admin) │ route handlers          │
└─────────────────────────┬────────────────────────────────────┘
                          │ HTTPS / REST  ·  🚧 WebSocket
┌─────────────────────────▼────────────────────────────────────┐
│          ✅ NestJS 11 — Modular REST API                      │
│   Auth │ Guards │ Pipes │ Exception Filters │ Throttler       │
└──────┬───────────────┬───────────────────┬────────────────────┘
       │               │                   │
 ┌─────▼──────┐  ┌─────▼──────┐   ┌───────▼───────┐
 │ ✅ Prisma 7 │  │ 🚧 Redis    │   │ ✅ Stripe API  │
 │  + pg      │  │  + BullMQ   │   │  🚧 Connect    │
 └─────┬──────┘  └────────────┘   └───────────────┘
       │
 ┌─────▼──────────┐   ┌──────────────┐
 │ ✅ PostgreSQL 16│   │ 🚧 S3 /       │
 │                │   │   Cloudinary  │
 └────────────────┘   └──────────────┘
```

### Patterns

- ✅ **Domain-driven modules** — one NestJS module per business domain
- ✅ **Global `PrismaService`** with the Prisma 7 `pg` driver adapter
- ✅ **JWT refresh rotation** — 15m access tokens, SHA-256-hashed 7d refresh tokens
- ✅ **Atomic checkout** — vendor splitting, delivery pricing, stock decrement, order
  creation and cart clearing in one `$transaction`
- ✅ **Snapshots over joins for history** — `productName`, `variantName`, `unitPrice`
  and the whole shipping address are frozen onto the order
- ✅ **Centralised Prisma error mapping** — `P2002` → 409, `P2025` → 404, `P2003` → 400
- ✅ **Taxonomy and facets kept apart** — `Category` says what a product *is*,
  `segments` and `species` say who it is *for*
- ✅ **Derived parent status** — `Order.status` is recomputed from its `VendorOrder`
  rows rather than written directly
- ✅ **Scoped reads, not post-hoc checks** — ownership goes into the `where` clause, so
  a query cannot return someone else's row and forget to reject it
- ✅ **One app-configuration function** — `src/app.setup.ts` is called by both `main.ts`
  and the e2e suite, so the tested app cannot drift from the real one
- 🚧 **Monorepo** via npm workspaces (`apps/api`, `apps/web`, `packages/*`)
- 🚧 **BullMQ queues** for email, order processing and payouts

---

## Domain model

### Today ✅

```
User  (isVendor / isAdmin flags)
 ├── RefreshToken (1:N)   hashed, rotated on use
 ├── Address (1:N)        exactly one isDefault
 ├── Vendor (1:N)         a user may run several storefronts
 │    ├── isApproved      invisible to the public until an admin approves
 │    ├── Product (1:N)
 │    │    └── ProductVariant (1:N)   price + stock per variant
 │    ├── DeliveryZone (1:N)          country / state / city, most specific wins
 │    └── VendorOrder (1:N)           this vendor's half of a buyer order
 ├── Cart (1:1)           persisted server-side
 │    └── CartItem (1:N)  one line per (cart, product, variant)
 ├── Order (1:N)
 │    ├── itemsTotal + deliveryTotal = total
 │    ├── shippingAddressId → Address  (SetNull)
 │    ├── shippingSnapshot  Json       frozen copy of the address
 │    ├── VendorOrder (1:N)            one per vendor in the cart
 │    └── OrderItem (1:N)              snapshots name, variant and unitPrice
 └── Review (1:N)         unique per (product, author)

OrderItem belongs to BOTH an Order and a VendorOrder

Category   self-referential tree (parent / children)
 ├── segments[]           which segments this category belongs to; empty = any
 └── Product (1:N)        what the thing IS

Species    Dog · Chicken · …, each tagged with its own Segment
 └── Product (M:N)        which animals it suits

Segment    HUMAN · PET · LIVESTOCK (· POULTRY · AQUACULTURE, kinds of livestock)
 └── Product.segments[]   who it is FOR - an array, so one product serves several

Payment → Order (1:N)     one row per Stripe PaymentIntent

OrderStatus        PENDING · PAID · SHIPPED · DELIVERED · CANCELLED
VendorOrderStatus  PENDING · ACCEPTED · SHIPPED · DELIVERED · CANCELLED
PaymentStatus      PENDING · SUCCEEDED · FAILED
```

### Planned 🚧

```
User
 └── Notification (1:N)   delivered over WebSocket

Product
 └── ProductImage (1:N)   S3 / Cloudinary keys

Vendor
 └── stripeAccountId      Connect payouts

ProductVariant
 └── Batch (1:N)          lot number + expiry, a prerequisite for recalls
```

---

## Design notes

The decisions in the code worth knowing about. All of these are built.

### Why audience is a facet, not a parent category

The catalogue covers people, pets and livestock, but those are not three branches of
one tree. Make `Pets` a parent category and you need a `Supplements` node under it,
another under `Livestock`, another under `People` — the same subtree cloned three
times. Worse, a salmon oil that suits both dogs and their owners has to pick one
branch or be listed twice.

So `Category` carries only *what the thing is* — Dry Food, Supplements, Feeders,
Beverages — and stays audience-agnostic. Who it is for lives in two separate fields:

- **`segments`** — `HUMAN` · `PET` · `LIVESTOCK` · `POULTRY` · `AQUACULTURE`, a
  Postgres enum array on `Product`. A small closed set, so the database enforces the
  vocabulary and there is no join. Indexed with GIN, because a B-tree cannot answer
  *does this array contain `PET`*.
- **`species`** — a many-to-many to `Species` (Dog, Chicken, …). Open-ended, carries
  its own name and slug for category pages, and extends without a migration.

They are deliberately independent. Species mostly implies segment — a dog is a pet —
but segment is still stored on the product, because species-agnostic items exist (a
feed scoop, a stable disinfectant) and humans are not in the species table.

Filtering uses `hasSome`, not `hasEvery`: ticking two segment boxes means *either*,
which is what a shopper expects. `set`, not `connect`, on `PATCH`, so editing a
product replaces its species list rather than appending to it — and `speciesIds: []`
clears it.

`POULTRY` and `AQUACULTURE` are kinds of livestock rather than peers of it, so the
enum carries two levels. Each product is tagged with the one accurate value, and
`src/products/segment-hierarchy.ts` widens the *filter* instead — asking for
`LIVESTOCK` matches all three, asking for `POULTRY` stays narrow. Expanding on read
rather than on write means a vendor cannot forget to add the parent, and a chicken
feed can never go missing from the livestock navigation.

### Some categories do belong to a segment

Facets and taxonomy are separate, but they are not unrelated: *Dog Food* is a `PET`
category in a way that *Supplements* is not. So `Category.segments` is an optional
enum array with a deliberate meaning for empty:

- **empty** — the category spans every segment. Supplements, Beverages, Equipment.
- **populated** — the category only accepts products in those segments.

Creating or re-categorising a product checks the two against each other and rejects
the mismatch with a `400`, so *Dog Food* cannot end up tagged `HUMAN`. Without that
check such a product is invisible from both directions: it does not show up for
shoppers browsing pet food, and it does not show up for shoppers browsing by segment
either. The check is skipped entirely when the category declares no segments, so
generic categories stay generic.

On `PATCH`, the segments validated are *the ones in force after the patch* — the new
list if the request carries one, otherwise the product's current list. Validating only
what was sent would let a category change slip a product out of alignment.

### Who may add a species

Shared catalogue vocabulary is open to vendors but not unmoderated. A vendor whose
product needs a species nobody has listed `POST`s it and gets it back immediately,
flagged `isApproved: false`:

- **usable at once** on their own products, so nothing is blocked on review
- **hidden from `GET /species`**, so no shopper sees an unreviewed suggestion
- **deduplicated by slug** — a second vendor submitting `alpaca` receives the
  existing row untouched rather than a `409`, so the race is settled by a single
  `upsert` rather than by the application

An admin then approves it, corrects the name or segment, or merges a duplicate into
the real species. Merging moves every product link inside one transaction before
deleting the duplicate — the join table cascades, so an unwrapped delete would
silently drop the associations it had not yet moved. Deleting a species that
products still reference is refused with a `409` pointing at merge instead.

### One buyer order, one order per vendor

A cart spans vendors; fulfilment does not. Each vendor packs, ships and gets paid for
its own part on its own timeline, so checkout groups the cart by vendor and writes one
**`VendorOrder`** per group, each with its own status, subtotal and delivery fee.

The buyer still sees one `Order`. Its status is **derived, never written by a vendor**:
after any `VendorOrder` moves, the parent is recomputed from the least advanced of its
live siblings, so an order reads `SHIPPED` only once every vendor has shipped and
`DELIVERED` only once all of them have arrived. Cancelled siblings are excluded from
that calculation — otherwise a single cancellation would pin the parent in place
forever — and if *every* part is cancelled the parent becomes `CANCELLED` too.

`VendorOrder` transitions are forward-only and terminal states are final
(`PENDING → ACCEPTED | CANCELLED`, `ACCEPTED → SHIPPED | CANCELLED`,
`SHIPPED → DELIVERED`). Without that table a vendor could walk a `DELIVERED` order
back to `PENDING`, or un-cancel one whose stock has already been returned.

Vendors are scoped to the `VendorOrder`, not the parent: `GET /orders/vendor-orders/:id`
exposes the items, the delivery address and nothing at all about the other vendors
sharing that buyer order.

`OrderItem` belongs to both the `Order` and the `VendorOrder`, which means it cannot be
nest-created under either one alone — the row needs both foreign keys, so checkout
creates the `VendorOrder` first and then `createMany`s its items.

### Variants are additive

`ProductVariant` carries its own `price`, `stock` and optional `sku`. A product with no
variants keeps using `Product.price` and `Product.stock`, so adding the table required
no backfill and simple products stay simple.

Where a product *does* have variants, its own price is meaningless — nobody sells the
abstract product. So adding one to a cart without choosing a variant is a `400` naming
how many options exist, rather than a silent fallback to a price that is not for sale.
The cart also checks that the variant actually belongs to the product named, or a buyer
could pair a cheap variant id with an expensive product.

Stock moves to wherever it lives: checkout decrements the variant when the line has
one and the product otherwise, and cancellation returns it to the same place.
Returning a variant line's stock to the product would inflate a number nothing sells
from.

Because a cart can now hold 5kg *and* 25kg of the same product, `productId` no longer
identifies one cart line, so cart lines are addressed by their own id.

### Delivery is priced per vendor, most specific wins

A `DeliveryZone` is vendor-scoped and matched on country, then state, then city, where
a `null` means *anywhere in the level above*. One country-wide row is therefore a
complete, valid configuration. Candidates are fetched in a single query and ranked in
code — city (2) beats state (1) beats country (0) — rather than three round trips, and
`freeAbove` waives the fee at a subtotal threshold.

Checkout resolves a fee for **every** vendor in the cart and refuses the whole order
with a `400` if any of them does not deliver to the chosen address. It resolves them
*inside its own transaction* — `DeliveryZonesService.resolve` takes an optional
transaction client for exactly this — so the zones it priced against cannot change
between quoting and writing.

### Two unique indexes Prisma cannot express

`CartItem.variantId` and `DeliveryZone.state` / `.city` are nullable, and in Postgres
`NULL` is not equal to `NULL`. A plain `@@unique([cartId, productId, variantId])`
therefore does **not** stop the same no-variant product being added twice: both rows
have a null `variantId`, both are allowed. Prisma 7 has no `nullsNotDistinct`, so the
real constraints are hand-written expression indexes in the migration:

```sql
CREATE UNIQUE INDEX "CartItem_cart_product_variant_key"
  ON "CartItem"("cartId", "productId", COALESCE("variantId", ''));

CREATE UNIQUE INDEX "DeliveryZone_vendor_scope_key"
  ON "DeliveryZone"("vendorId", "country", COALESCE("state", ''), COALESCE("city", ''));
```

Because Prisma does not know these exist, the services cannot `upsert` against them:
the cart does find-then-write, and `DeliveryZonesService` checks the scope explicitly
so the normal path returns a readable `409` instead of a raw constraint violation.

A consequence worth remembering: `prisma db push` applies the schema but **not**
migration SQL, so a database built with `db push` silently lacks both indexes. The e2e
suite uses `prisma migrate deploy` precisely so it tests the schema that production
runs.

### Addresses are owned, and orders do not trust them

Every `AddressesService` method takes the caller's `userId` and puts it in the `where`
clause rather than checking ownership after the fact, so a query cannot return someone
else's row at all. A missing or foreign address is a `404`, not a `403` — a `403` would
confirm that the id exists. Checkout looks the address up the same way, scoped to the
buyer.

The first address a user saves is their default whatever the request says, and
promoting another clears the rest inside a transaction, so there is never a user with
two defaults or none. Deleting the default promotes a replacement.

Orders keep a **`shippingSnapshot`**: `Order.shippingAddressId` is `onDelete: SetNull`,
so a buyer may edit or delete an address freely and a past order still records where it
actually went.

### Money, stock, tokens

**Money is stored in minor units.** `Product.price`, `ProductVariant.price`,
`DeliveryZone.fee` and the order totals are all `Int` — cents, kobo, pence. No floating
point anywhere near a price. `Order.total` is `itemsTotal + deliveryTotal`, both stored.

**Stock decrements are race-safe.** Each line uses a conditional
`updateMany({ where: { id, stock: { gte: quantity } } })`; a `count` of `0` means
someone else took the last unit first, and the whole transaction rolls back with `409`.
A read-then-write would let two simultaneous checkouts both pass the check.

**Line items are immutable.** `OrderItem` stores `productName`, `variantName` and
`unitPrice` as they were at purchase, so renaming or repricing never rewrites history.
`OrderItem.product` uses `onDelete: Restrict` and `OrderItem.variant` likewise;
`CartItem` cascades, because a cart is ephemeral and an order is a record. A variant
that has been ordered cannot be deleted — the API says so with a `409` pointing at
`isActive` rather than leaking a foreign-key error.

**Cancellation restocks.** `PATCH /orders/:id/cancel` re-reads the status inside the
transaction, refuses anything but `PENDING`, returns stock to the variant or product it
came from, and cancels every `VendorOrder`. `PATCH /orders/:id` explicitly rejects
`CANCELLED` so the restock path cannot be bypassed.

**Refresh tokens rotate, and reuse is detected.** Tokens are stored as SHA-256 hashes and
consumed with a conditional delete. A token that verifies but has no row was already
redeemed — treated as theft, and every session for that user is dropped. A token that
merely aged out retires only itself.

**Login timing is constant.** An unknown email is compared against a dummy bcrypt hash at
the same cost factor, so response time cannot be used to enumerate registered addresses.

**Stripe calls are idempotent.** `createIntent` passes an idempotency key derived from the
order, so a reloaded checkout page gets the same intent back rather than a second payable
one. The webhook acknowledges intents it holds no row for — rather than erroring and
triggering three days of retries — and refuses to mark a cancelled order paid.

**Route declaration order is load-bearing.** Nest matches in declaration order, so every
literal route (`/species/mine`, `/vendors/pending`, `/orders/vendor-orders/:id`) is
declared before the `:id` route that would otherwise swallow it.

---

## API reference

Every endpoint below is served under **`/api/v1`** — so `/auth/login` is really
`POST /api/v1/auth/login`. The paths are written relative to that prefix for
readability. `GET /health` is the one exception and stays at the root, where uptime
checks expect it. Interactive docs are at `/api/docs`, also unprefixed.

### Auth
| Method | Endpoint | Access | Notes |
|---|---|---|---|
| `POST` | `/auth/register` | public | returns a token pair · 5/min |
| `POST` | `/auth/login` | public | returns a token pair · 5/min |
| `POST` | `/auth/refresh` | public | rotates the pair · 5/min |
| `POST` | `/auth/logout` | public | invalidates one refresh token · 5/min |

### Users
| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/users` | admin |
| `GET` · `PATCH` · `DELETE` | `/users/:id` | self or admin |

### Vendors
| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/vendors` | authenticated — created unapproved |
| `GET` | `/vendors` | public, paginated — **approved only** |
| `GET` | `/vendors/pending` | admin — the approval queue |
| `GET` | `/vendors/:id` | public |
| `PATCH` | `/vendors/:id/approve` | admin — idempotent |
| `PATCH` | `/vendors/:id/revoke` | admin — hides without deleting |
| `PATCH` · `DELETE` | `/vendors/:id` | vendor owner or admin |

### Products
| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/products` | owner of the target vendor |
| `GET` | `/products` | public, paginated, searchable and filterable — **approved vendors only** |
| `GET` | `/products/:id` | public |
| `PATCH` · `DELETE` | `/products/:id` | product's vendor owner or admin |

### Product variants
| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/products/:id/variants` | public — cheapest first |
| `POST` | `/products/:id/variants` | product's vendor owner or admin |
| `GET` | `/variants/:variantId` | public |
| `PATCH` | `/variants/:variantId` | product's vendor owner or admin |
| `DELETE` | `/variants/:variantId` | owner or admin — `409` once ordered |

### Addresses — all authenticated, always scoped to the caller
| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/addresses` | default first |
| `POST` | `/addresses` | the first one saved becomes the default |
| `GET` · `PATCH` · `DELETE` | `/addresses/:id` | `404` if it is not yours |

### Delivery zones
| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/vendors/:id/delivery-zones` | public |
| `GET` | `/vendors/:id/delivery-quote?state=&city=&country=&subtotal=` | public — `null` when the vendor does not deliver there |
| `POST` | `/vendors/:id/delivery-zones` | vendor owner or admin · `409` on an overlapping scope |
| `PATCH` · `DELETE` | `/delivery-zones/:zoneId` | zone's vendor owner or admin |

### Species
| Method | Endpoint | Access |
|---|---|---|
| `GET` | `/species` | public — approved only, A-Z, `?segment=` filterable |
| `GET` | `/species/mine` | authenticated — your suggestions, pending included |
| `GET` | `/species/pending` | admin — the review queue |
| `GET` | `/species/:id` | public |
| `POST` | `/species` | vendor — creates unapproved, or returns the existing match (5/hour) |
| `PATCH` | `/species/:id/approve` | admin |
| `PATCH` | `/species/:id` | admin — correct name or segment |
| `POST` | `/species/:id/merge` | admin — move product links to `targetId`, delete this one |
| `DELETE` | `/species/:id` | admin — only when no product references it |

#### Paginated listings

`GET /products` and `GET /vendors` return a page, not a bare array:

```json
{
  "data": [ { "id": "...", "name": "Cold Pressed Ginger Shot 250ml", "price": 4999 } ],
  "meta": { "total": 47, "page": 2, "limit": 20, "pageCount": 3 }
}
```

| Parameter | Default | Notes |
|---|---|---|
| `page` | `1` | 1-based; a page past the end returns an empty `data` |
| `limit` | `20` | capped at `100`, so no request can pull the whole table |
| `sortBy` | `createdAt` | products: `createdAt`, `price`, `name`, `stock` · vendors: `createdAt`, `name` |
| `order` | `desc` | `asc` or `desc` |
| `q` | — | products only; case-insensitive match across name and description |
| `vendorId` | — | products only; the `total` reflects the filter |
| `categoryId` | — | products only; **includes the whole subtree** of that category |
| `segments` | — | products only; repeat the key to widen — `?segments=PET&segments=HUMAN` matches **either**. `LIVESTOCK` also matches `POULTRY` and `AQUACULTURE` |
| `speciesId` | — | products only; matches products connected to that species |

Anything outside those bounds is a `400` before the query is built — `?limit=10000`,
`?page=0` and `?sortBy=passwordHash` are all rejected. Unknown parameters are stripped
and ignored. The page and its `total` are read in one transaction, so they never
disagree.

`categoryId` walks the tree with a recursive CTE, so picking *Dog Food* also returns
*Dog Food › Puppy Food*. The recursion uses `UNION` rather than `UNION ALL`, which is
the cycle guard: a repeated row ends the walk, so even a malformed tree returns a
finite set instead of hanging. Re-parenting a category under its own descendant is
rejected with a `400` before it can create such a tree.

`q` uses `ILIKE '%…%'`, which cannot use an index — fine at this size, and the line to
replace with a `tsvector` column and a GIN index when the catalogue grows.

### Categories
| Method | Endpoint | Access |
|---|---|---|
| `POST` · `PATCH` · `DELETE` | `/categories[/:id]` | admin |
| `GET` | `/categories`, `/categories/:id` | public |

Categories accept an optional `segments` array. Empty means the category spans every
segment; populated means products in it must match.

### Cart — all authenticated, always scoped to the caller
| Method | Endpoint | Notes |
|---|---|---|
| `GET` | `/cart` | items include their product and variant |
| `POST` | `/cart/items` | `{ productId, variantId?, quantity }` — increments an existing line |
| `PATCH` · `DELETE` | `/cart/items/:itemId` | **cart item id**, not product id |
| `DELETE` | `/cart` | empties the cart |

### Orders — all authenticated
| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/orders` | checks out the caller's cart — **requires `{ shippingAddressId }`** |
| `GET` | `/orders` | the caller's own orders, with their vendor orders |
| `GET` | `/orders/vendor/:vendorId` | that vendor's owner — its `VendorOrder`s, `?status=` filterable |
| `GET` | `/orders/vendor-orders/:vendorOrderId` | that vendor order's owner |
| `PATCH` | `/orders/vendor-orders/:vendorOrderId/status` | that vendor order's owner — forward only |
| `GET` | `/orders/:id` | buyer or admin |
| `PATCH` | `/orders/:id` | admin — set status |
| `PATCH` | `/orders/:id/cancel` | buyer or admin, `PENDING` only |

`POST /orders` returns `400` when the cart is empty, a product or variant is no longer
available, or **any vendor in the cart does not deliver to the chosen address**; `404`
when the address is not the caller's; `409` when stock ran out mid-checkout.

### Reviews
| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/reviews` | authenticated, delivered purchase required |
| `GET` | `/reviews?productId=`, `/reviews/:id` | public |
| `PATCH` · `DELETE` | `/reviews/:id` | author or admin |

### Payments · Admin · Health
| Method | Endpoint | Access |
|---|---|---|
| `POST` | `/payments/create-intent` | authenticated, own `PENDING` order |
| `POST` | `/payments/webhook` | Stripe signature |
| `GET` | `/admin/stats` | admin |
| `GET` | `/health` | public |

A global rate limit of 100 requests/minute applies, auth routes are tightened to
5/minute, and the Stripe webhook is exempt.

---

## Repository structure

### Today

```
nuvita/
├── api/                           # NestJS API
│   ├── src/
│   │   ├── main.ts
│   │   ├── app.setup.ts           # shared by main.ts and the e2e suite
│   │   ├── app.module.ts
│   │   ├── common/
│   │   │   ├── dto/               # pagination query + {data, meta} envelope
│   │   │   ├── filters/           # global Prisma → HTTP mapping
│   │   │   └── utils/
│   │   ├── prisma/
│   │   ├── auth/      users/       vendors/
│   │   ├── products/  categories/  carts/
│   │   ├── species/   orders/      reviews/
│   │   ├── product-variants/
│   │   ├── addresses/ delivery-zones/
│   │   ├── payments/
│   │   └── admin/
│   ├── prisma/
│   │   ├── schema.prisma
│   │   ├── seed.ts                # the starting species list, idempotent
│   │   └── migrations/            # includes two hand-written COALESCE indexes
│   ├── test/                      # e2e suite + disposable-DB guard
│   └── docker-compose.test.yml
└── README.md
```

### Planned 🚧

`api/` becomes `apps/api`, joined by `apps/web` (Next.js) and `packages/{types,utils,config}`
under npm workspaces.

---

## Getting started

### Prerequisites

- Node.js 20+
- PostgreSQL 16 (or a managed instance)
- Docker, for the test database
- A Stripe account in test mode

### Install and run

```bash
git clone <your-repo-url> nuvita
cd nuvita/api

npm install
cp .env.example .env        # then fill it in

npx prisma migrate deploy   # NOT db push - see "Two unique indexes"
npx prisma generate
npx tsx prisma/seed.ts      # the starting species list

npm run start:dev
```

> API → `http://localhost:3000/api/v1`
> Swagger → `http://localhost:3000/api/docs`
> Health → `http://localhost:3000/health`

Use `migrate deploy`, not `db push`: two unique indexes exist only in migration SQL and
`db push` would skip them.

The seed runs under `tsx` rather than `ts-node` — the generated Prisma client is
TypeScript with ESM-style `.js` import specifiers, which `ts-node` cannot resolve.

A newly created vendor is unapproved and invisible, so after seeding a development
catalogue, approve its vendors or `GET /products` comes back empty:

```bash
# PATCH /api/v1/vendors/:id/approve   as an admin
```

If you forward Stripe webhooks locally, the path is prefixed too:

```bash
stripe listen --forward-to localhost:3000/api/v1/payments/webhook
```

### Environment

```env
DATABASE_URL="postgresql://user:password@localhost:5432/nuvita"

JWT_SECRET="..."
JWT_REFRESH_SECRET="..."

STRIPE_SECRET_KEY="sk_test_..."
STRIPE_WEBHOOK_SECRET="whsec_..."

PORT=3000
```

Against a managed Postgres that sleeps when idle, add
`?connect_timeout=30&sslmode=require` — a cold start can otherwise surface as `P1001`
on the first connection and succeed on the next.

---

## Testing

```bash
npx tsc --noEmit        # type check first - it catches what Jest cannot
npm test                # 340 unit tests, 34 suites

npm run test:e2e:up     # start the throwaway Postgres container
npm run test:e2e        # 96 tests, 3 suites, against a real database
npm run test:e2e:down   # tear it down
```

The end-to-end suite truncates every table before each test, so it refuses to start
unless `DATABASE_URL` points at a **loopback host** whose database name ends in `_test`.
`npm run test:e2e` supplies that URL inline; running Jest against the e2e config by hand
is blocked rather than pointed at your development database.

It builds its schema with `prisma migrate deploy`, not `db push`, so the two
hand-written COALESCE indexes are present and actually under test.

Coverage includes per-vendor order splitting, delivery-zone resolution and refusal,
variant pricing and stock, address ownership and defaulting, vendor approval gating the
public catalogue, recursive category filtering, category/segment validation, checkout,
stock exhaustion, cancellation and restock, cross-user authorization on orders,
vendors, products, addresses and accounts, review eligibility, the one-review-per-buyer
database constraint, admin role gating, and DTO validation.

---

## Tech stack

### Backend

| Layer | Technology | State |
|---|---|---|
| Framework | NestJS 11 | ✅ |
| Language | TypeScript 5 | ✅ |
| ORM | Prisma 7 + `pg` driver adapter | ✅ |
| Database | PostgreSQL 16 | ✅ |
| Auth | Passport (local + JWT), bcrypt | ✅ |
| Payments | Stripe PaymentIntents + webhooks | ✅ |
| Rate limiting | `@nestjs/throttler` | ✅ |
| Docs | Swagger / OpenAPI 3 | ✅ |
| Testing | Jest, Supertest, Dockerised Postgres | ✅ |
| Cache / Queue | Redis + BullMQ | 🚧 |
| File storage | S3 / Cloudinary | 🚧 |
| Email | Nodemailer + SendGrid | 🚧 |
| Realtime | Socket.IO | 🚧 |
| Payouts | Stripe Connect | 🚧 |

### Frontend 🚧

Next.js 15 (App Router) · Tailwind CSS v4 · shadcn/ui · Zustand · TanStack Query ·
React Hook Form + Zod · Stripe.js Elements · Recharts · Vitest + Playwright

---

## Roadmap

Ordered so that migrations with wide reach land before the client that would have to
be rewritten around them. The schema work is done; infrastructure is next.

### Next — infrastructure
- [ ] Redis cache for the public catalogue, invalidated on write
- [ ] BullMQ queues for email, order processing and payouts
- [ ] S3 / Cloudinary uploads for vendor and product media
- [ ] `Notification` model + Socket.IO gateway for order and vendor-order status
- [ ] Observability — structured logging, request ids, Sentry

### Then — payouts
- [ ] Stripe Connect per vendor, with `VendorOrder.subtotal` as the payout unit
- [ ] Platform commission and vendor statements

### Then — client
- [ ] npm workspaces restructure (`apps/api`, `apps/web`, `packages/*`)
- [ ] Next.js 15 customer, vendor and admin portals
- [ ] Stripe Elements checkout
- [ ] Mobile app (React Native / Expo)

### Later
- [ ] Batch and expiry tracking per variant — real for food, beverages and
      supplements, and a prerequisite for recalls
- [ ] `tsvector` product search to replace `ILIKE`
- [ ] Returns and refunds

---

## Deployment

| Service | Purpose |
|---|---|
| Neon | Managed PostgreSQL |
| Railway / Render | NestJS API |
| Vercel | 🚧 Next.js frontend |
| Upstash | 🚧 Managed Redis |
| Cloudinary | 🚧 Image storage |
| Stripe | Payments · 🚧 Connect payouts |

### Checklist

- [ ] Set all production environment variables
- [ ] `npx prisma migrate deploy` against the production database — never `db push`
- [ ] Point the Stripe webhook at the production URL and set `STRIPE_WEBHOOK_SECRET`
- [ ] Enable CORS for the production frontend origin
- [ ] Seed the species list
- [ ] Approve the launch vendors, or the catalogue is empty
- [ ] Error monitoring (Sentry)
- [ ] Review the rate limits for production traffic

---

<div align="center">

**Nuvita** — nutrition and wellness commerce, for every species.

</div>
