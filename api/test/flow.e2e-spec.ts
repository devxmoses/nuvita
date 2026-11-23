import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication} from '@nestjs/common';
import request from 'supertest'
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthService } from '../src/auth/auth.service';
import { ThrottlerStorage } from '@nestjs/throttler';
import { resetThrottler } from './reset-throttler';
import { configureApp } from '../src/app.setup';

describe('Marketplace flow (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let auth: AuthService;
  let throttlerStorage: any;
  let seq = 0;

  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    prisma = app.get(PrismaService);
    auth = app.get(AuthService);
    throttlerStorage = app.get<any>(ThrottlerStorage);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables
      WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    `;
    const list = tables.map((t) => `"public"."${t.tablename}"`).join(', ');
    if (list) {
      await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
    }

    // The global limit is 100 requests/minute and the throttler keys on IP, so
    // every request in this file shares one bucket. Without clearing it the suite
    // starts 429ing partway down, which says nothing about the code under test.
    resetThrottler(throttlerStorage);
  });

  // Users are seeded directly and tokens minted through the app's own AuthService.
  // Going through POST /auth/register for every test would trip its 5/min throttle
  // partway down the file; one test below still exercises that route for real.
  const seedUser = async (over: Record<string, unknown> = {}) => {
    seq += 1;
    const user = await prisma.user.create({
      data: {
        email: `person-${seq}@test.com`,
        passwordHash: 'not-used-in-these-tests',
        name: `Person ${seq}`,
        ...over,
      },
    });

    const { access_token } = await auth.login({
      id: user.id,
      email: user.email,
      isAdmin: user.isAdmin,
      isVendor: user.isVendor,
    });

    return { user, token: access_token };
  };

  // A vendor is unapproved on creation now, and its products stay out of the
  // public catalogue until an admin approves it. Written straight to the
  // database so these tests do not need an admin token each time.
  const approveVendor = (vendorId: string) =>
    prisma.vendor.update({
      where: { id: vendorId },
      data: { isApproved: true, approvedAt: new Date() },
    });

  // checkout refuses a vendor that does not deliver to the address, so every
  // vendor in these tests gets one country-wide, free zone
  const seedZone = (vendorId: string, fee = 0) =>
    prisma.deliveryZone.create({
      data: { vendorId, name: 'Nationwide', country: 'NG', fee },
    });

  // created through the API with the caller own token, so the address is
  // theirs by construction and no user id has to be threaded around
  const seedAddress = async (token: string) => {
    const res = await http()
      .post('/api/v1/addresses')
      .set('Authorization', `Bearer ${token}`)
      .send({ line1: '12 Agodi Road', city: 'Ibadan', state: 'Oyo', country: 'NG' })
      .expect(201);
    return res.body.id as string;
  };

  // POST /orders now takes the address to ship to. The expected status is a
  // parameter because awaiting a supertest request runs it - the helper cannot
  // hand back something still chainable.
  const checkout = async (token: string, expectStatus = 201) => {
    const addressId = await seedAddress(token);
    return http()
      .post('/api/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ shippingAddressId: addressId })
      .expect(expectStatus);
  };

  const listProduct = async (token: string, stock = 10, price = 4999) => {
    const vendor = await http()
      .post('/api/v1/vendors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Green Valley Nutrition ${seq}` })
      .expect(201);
    await approveVendor(vendor.body.id);
    await seedZone(vendor.body.id);

    const product = await http()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Cold Pressed Ginger Shot 250ml', price, stock, vendorId: vendor.body.id,
              segments: ['HUMAN'] })
      .expect(201);

    return { vendorId: vendor.body.id as string, productId: product.body.id as string };
  };

  const addToCart = (token: string, productId: string, quantity: number) =>
    http()
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, quantity })
      .expect(201);

  // cart lines are addressed by their own id now: with variants, productId no
  // longer identifies one line
  const cartItemId = async (token: string, productId: string) => {
    const cart = await http()
      .get('/api/v1/cart')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return cart.body.items.find((item: any) => item.productId === productId).id as string;
  };

  it('registers a user over HTTP and returns a usable token pair', async () => {
    const res = await http()
      .post('/api/v1/auth/register')
      .send({ email: 'registered@test.com', password: 'password123', name: 'Registered' })
      .expect(201);

    expect(res.body.access_token).toBeDefined();
    expect(res.body.refresh_token).toBeDefined();

    // the issued token actually authenticates against a protected route
    await http().get('/api/v1/cart').set('Authorization', `Bearer ${res.body.access_token}`).expect(200);
  });

  it('runs vendor -> product -> cart -> checkout end to end', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token, 10, 4999);

    await addToCart(token, productId, 2);

    const cart = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0].quantity).toBe(2);

    const order = await checkout(token);

    expect(order.body.total).toBe(9998);
    expect(order.body.status).toBe('PENDING');
    expect(order.body.items).toHaveLength(1);
    expect(order.body.items[0].unitPrice).toBe(4999);
    expect(order.body.items[0].productName).toBe('Cold Pressed Ginger Shot 250ml');

    // stock decremented and cart emptied inside the same transaction
    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(8);

    const emptied = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(emptied.body.items).toHaveLength(0);
  });

  it('changes a cart line quantity before checkout', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 2);

    await http()
      .patch(`/api/v1/cart/items/${await cartItemId(token, productId)}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ quantity: 5 })
      .expect(200);

    const cart = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(cart.body.items[0].quantity).toBe(5);
  });

  it('removes a cart line', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 1);

    await http()
      .delete(`/api/v1/cart/items/${await cartItemId(token, productId)}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const cart = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(cart.body.items).toHaveLength(0);
  });

  it('empties the whole cart', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 2);

    await http().delete('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);

    const cart = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(cart.body.items).toHaveLength(0);
  });

  it('adding the same product twice increments rather than duplicating', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 2);
    await addToCart(token, productId, 3);

    const cart = await http().get('/api/v1/cart').set('Authorization', `Bearer ${token}`).expect(200);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0].quantity).toBe(5);
  });

  it('refuses checkout on an empty cart', async () => {
    const { token } = await seedUser();

    await checkout(token, 400);
  });

  it('refuses checkout when stock is short, leaving stock untouched', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token, 1);

    await addToCart(token, productId, 5);

    await checkout(token, 409);

    const product = await prisma.product.findUnique({ where: { id: productId } });
    expect(product!.stock).toBe(1);
  });

  it('cancels a pending order and restocks it', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token, 10);

    await addToCart(token, productId, 3);
    const order = await checkout(token);

    const afterCheckout = await prisma.product.findUnique({ where: { id: productId } });
    expect(afterCheckout!.stock).toBe(7);

    const cancelled = await http()
      .patch(`/api/v1/orders/${order.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cancelled.body.status).toBe('CANCELLED');

    const afterCancel = await prisma.product.findUnique({ where: { id: productId } });
    expect(afterCancel!.stock).toBe(10);
  });

  it('refuses to cancel an order that is no longer pending', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 1);
    const order = await checkout(token);

    await prisma.order.update({ where: { id: order.body.id }, data: { status: 'SHIPPED' } });

    await http()
      .patch(`/api/v1/orders/${order.body.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(409);
  });

  it("does not let another user read or cancel somebody else's order", async () => {
    const owner = await seedUser();
    const { productId } = await listProduct(owner.token);
    await addToCart(owner.token, productId, 1);
    const order = await checkout(owner.token);

    const stranger = await seedUser();

    await http()
      .get(`/api/v1/orders/${order.body.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);

    await http()
      .patch(`/api/v1/orders/${order.body.id}/cancel`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);
  });

  it('does not let a non-owner list products under your vendor', async () => {
    const owner = await seedUser();
    const { vendorId } = await listProduct(owner.token);

    const stranger = await seedUser();

    await http()
      .post('/api/v1/products')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ name: 'Counterfeit Tonic', price: 100, stock: 1, vendorId, segments: ['HUMAN'] })
      .expect(403);
  });

  it('lets a vendor owner see order items for their own vendor only', async () => {
    const owner = await seedUser();
    const { vendorId, productId } = await listProduct(owner.token);
    await addToCart(owner.token, productId, 2);
    await checkout(owner.token);

    const mine = await http()
      .get(`/api/v1/orders/vendor/${vendorId}`)
      .set('Authorization', `Bearer ${owner.token}`)
      .expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0].vendorId).toBe(vendorId);

    const stranger = await seedUser();
    await http()
      .get(`/api/v1/orders/vendor/${vendorId}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);
  });

  it('rejects a review for a product the buyer has not received', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await http()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, rating: 5, comment: 'Great' })
      .expect(403);
  });

  it('accepts one review per buyer once the order is delivered', async () => {
    const { token } = await seedUser();
    const { productId } = await listProduct(token);

    await addToCart(token, productId, 1);
    const order = await checkout(token);

    await prisma.order.update({ where: { id: order.body.id }, data: { status: 'DELIVERED' } });

    const review = await http()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, rating: 5, comment: 'Arrived cold and tasted fresh.' })
      .expect(201);
    expect(review.body.rating).toBe(5);

    // the one-review-per-product rule is enforced by the database unique constraint
    await http()
      .post('/api/v1/reviews')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId, rating: 4 })
      .expect(409);
  });

  it('keeps admin-only routes closed to ordinary users', async () => {
    const { token } = await seedUser();

    await http().get('/api/v1/admin/stats').set('Authorization', `Bearer ${token}`).expect(403);
  });

  it('serves admin stats to an admin', async () => {
    const { token } = await seedUser({ isAdmin: true });

    const res = await http().get('/api/v1/admin/stats').set('Authorization', `Bearer ${token}`).expect(200);

    expect(typeof res.body.totals.users).toBe('number');
    expect(res.body.revenue).toHaveProperty('collected');
  });

  it('requires authentication on protected routes', async () => {
    await http().get('/api/v1/cart').expect(401);
    await http().post('/api/v1/orders').expect(401);
    await http().get('/api/v1/admin/stats').expect(401);
  });

  it('rejects an invalid payload before it reaches the service', async () => {
    const { token } = await seedUser();

    await http()
      .post('/api/v1/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productId: 'p1', quantity: 0 })
      .expect(400);
  });

    it('does not hand out a user record to an anonymous caller', async () => {
    const { user } = await seedUser();

    await http().get(`/api/v1/users/${user.id}`).expect(401);
  });

  it("does not let one user read another user's account", async () => {
    const victim = await seedUser();
    const stranger = await seedUser();

    await http()
      .get(`/api/v1/users/${victim.user.id}`)
      .set('Authorization', `Bearer ${stranger.token}`)
      .expect(403);
  });

  it('lets a user read their own account, without the password hash', async () => {
    const me = await seedUser();

    const res = await http()
      .get(`/api/v1/users/${me.user.id}`)
      .set('Authorization', `Bearer ${me.token}`)
      .expect(200);

    expect(res.body.email).toBe(me.user.email);
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('lets an admin read anybody', async () => {
    const victim = await seedUser();
    const admin = await seedUser({ isAdmin: true });

    const res = await http()
      .get(`/api/v1/users/${victim.user.id}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .expect(200);

    expect(res.body.id).toBe(victim.user.id);
  });

  it('serves a health check without a token', async () => {
    const res = await http().get('/health').expect(200);

    expect(res.body.status).toBe('ok');
  });

    describe('product listing pagination', () => {
    // three products from one vendor, with known prices so sort order is checkable
    const seedCatalogue = async () => {
      const { token } = await seedUser();
      const vendor = await http()
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Green Valley Nutrition ${(seq += 1)}` })
        .expect(201);
      await approveVendor(vendor.body.id);
      await seedZone(vendor.body.id);

      for (const [name, price] of [
        ['Layer Mash 25kg', 1500],
        ['Cold Pressed Ginger Shot 250ml', 4999],
        ['Omega Oil for Dogs 500ml', 3200],
      ] as [string, number][]) {
        await http()
          .post('/api/v1/products')
          .set('Authorization', `Bearer ${token}`)
          .send({ name, price, stock: 5, vendorId: vendor.body.id, segments: ['HUMAN'] })
          .expect(201);
      }

      return { token, vendorId: vendor.body.id };
    };

    it('wraps the rows in data with pagination meta', async () => {
      await seedCatalogue();

      const res = await http().get('/api/v1/products').expect(200);

      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data).toHaveLength(3);
      expect(res.body.meta).toEqual({ total: 3, page: 1, limit: 20, pageCount: 1 });
    });

    it('serves one page at a time and reports how many there are', async () => {
      await seedCatalogue();

      const first = await http().get('/api/v1/products?page=1&limit=2').expect(200);
      expect(first.body.data).toHaveLength(2);
      expect(first.body.meta).toEqual({ total: 3, page: 1, limit: 2, pageCount: 2 });

      const second = await http().get('/api/v1/products?page=2&limit=2').expect(200);
      expect(second.body.data).toHaveLength(1);
      expect(second.body.meta.page).toBe(2);

      // no row appears on both pages
      const ids = [...first.body.data, ...second.body.data].map((p: any) => p.id);
      expect(new Set(ids).size).toBe(3);
    });

    it('returns an empty page past the end rather than an error', async () => {
      await seedCatalogue();

      const res = await http().get('/api/v1/products?page=99&limit=2').expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(3);
    });

    it('sorts by price in both directions', async () => {
      await seedCatalogue();

      const asc = await http().get('/api/v1/products?sortBy=price&order=asc').expect(200);
      expect(asc.body.data.map((p: any) => p.price)).toEqual([1500, 3200, 4999]);

      const desc = await http().get('/api/v1/products?sortBy=price&order=desc').expect(200);
      expect(desc.body.data.map((p: any) => p.price)).toEqual([4999, 3200, 1500]);
    });

    it('still honours the vendor filter, and counts only that vendor', async () => {
      const mine = await seedCatalogue();
      await seedCatalogue(); // a second vendor's products must not be counted

      const res = await http()
        .get(`/api/v1/products?vendorId=${mine.vendorId}`)
        .expect(200);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.every((p: any) => p.vendorId === mine.vendorId)).toBe(true);
    });

    it('caps limit so one request cannot ask for the whole table', async () => {
      await http().get('/api/v1/products?limit=10000').expect(400);
    });

    it('rejects a page or limit that is not a positive integer', async () => {
      await http().get('/api/v1/products?page=0').expect(400);
      await http().get('/api/v1/products?page=-1').expect(400);
      await http().get('/api/v1/products?page=abc').expect(400);
      await http().get('/api/v1/products?limit=1.5').expect(400);
    });

    it('refuses to sort by a column that is not on the allowlist', async () => {
      await http().get('/api/v1/products?sortBy=vendorId').expect(400);
      await http().get('/api/v1/products?order=sideways').expect(400);
    });

    it('ignores an unknown query parameter instead of failing', async () => {
      await seedCatalogue();

      const res = await http().get('/api/v1/products?nonsense=1').expect(200);

      expect(res.body.data).toHaveLength(3);
    });
  });

  describe('segment and species filtering', () => {
    const seedSpecies = async () => {
      const dog = await prisma.species.create({
        data: { name: 'Dog', slug: 'dog', segment: 'PET' },
      });
      const chicken = await prisma.species.create({
        data: { name: 'Chicken', slug: 'chicken', segment: 'LIVESTOCK' },
      });
      return { dog, chicken };
    };

    // one product per segment, plus a dual-segment one, so hasSome is observable
    const seedMixedCatalogue = async () => {
      const { token } = await seedUser();
      const vendor = await http()
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Green Valley Nutrition ${(seq += 1)}` })
        .expect(201);
      await approveVendor(vendor.body.id);
      await seedZone(vendor.body.id);

      const { dog, chicken } = await seedSpecies();

      const make = async (
        name: string,
        segments: string[],
        speciesIds: string[] = [],
      ) => {
        const res = await http()
          .post('/api/v1/products')
          .set('Authorization', `Bearer ${token}`)
          .send({ name, price: 1000, stock: 5, vendorId: vendor.body.id, segments, speciesIds })
          .expect(201);
        return res.body;
      };

      return {
        token,
        dog,
        chicken,
        ginger: await make('Cold Pressed Ginger Shot 250ml', ['HUMAN']),
        kibble: await make('Grain Free Kibble 12kg', ['PET'], [dog.id]),
        mash: await make('Layer Mash 25kg', ['LIVESTOCK'], [chicken.id]),
        // salmon oil suits dogs and people - the case a category tree cannot express
        oil: await make('Wild Salmon Oil 500ml', ['HUMAN', 'PET'], [dog.id]),
      };
    };

    const seedVendorFor = async (token: string) => {
      const res = await http()
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Green Valley Nutrition ${(seq += 1)}` })
        .expect(201);
      await approveVendor(res.body.id);
      await seedZone(res.body.id);
      return res.body.id;
    };

    it('stores segments and returns the connected species on create', async () => {
      const { kibble } = await seedMixedCatalogue();

      expect(kibble.segments).toEqual(['PET']);
      expect(kibble.species.map((s: any) => s.slug)).toEqual(['dog']);
    });

    it('requires at least one segment', async () => {
      const { token } = await seedUser();
      const vendorId = await seedVendorFor(token);

      await http()
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Unreachable Product', price: 100, stock: 1, vendorId })
        .expect(400);

      await http()
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Unreachable Product', price: 100, stock: 1, vendorId, segments: [] })
        .expect(400);
    });

    it('rejects a species id that does not exist', async () => {
      const { token } = await seedUser();
      const vendorId = await seedVendorFor(token);

      await http()
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Mystery Supplement', price: 100, stock: 1, vendorId,
                segments: ['PET'], speciesIds: ['no-such-species'] })
        .expect(404);
    });

    it('replaces the species list on PATCH rather than adding to it', async () => {
      const { token, kibble, chicken } = await seedMixedCatalogue();

      const patched = await http()
        .patch(`/api/v1/products/${kibble.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ speciesIds: [chicken.id] })
        .expect(200);

      expect(patched.body.species.map((s: any) => s.slug)).toEqual(['chicken']);
    });

    it('clears the species list when PATCHed with an empty array', async () => {
      const { token, kibble } = await seedMixedCatalogue();

      const patched = await http()
        .patch(`/api/v1/products/${kibble.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ speciesIds: [] })
        .expect(200);

      expect(patched.body.species).toEqual([]);
    });

    it('filters to one segment', async () => {
      await seedMixedCatalogue();

      const res = await http().get('/api/v1/products?segments=LIVESTOCK').expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].name).toBe('Layer Mash 25kg');
    });

    it('widens to either segment when the key is repeated', async () => {
      await seedMixedCatalogue();

      const res = await http()
        .get('/api/v1/products?segments=PET&segments=LIVESTOCK')
        .expect(200);

      // kibble (PET), mash (LIVESTOCK) and the dual-segment oil - not the ginger shot
      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.map((p: any) => p.name).sort()).toEqual([
        'Grain Free Kibble 12kg',
        'Layer Mash 25kg',
        'Wild Salmon Oil 500ml',
      ]);
    });

    it('finds a dual-segment product from either side', async () => {
      await seedMixedCatalogue();

      const human = await http().get('/api/v1/products?segments=HUMAN').expect(200);
      const pet = await http().get('/api/v1/products?segments=PET').expect(200);

      const name = 'Wild Salmon Oil 500ml';
      expect(human.body.data.map((p: any) => p.name)).toContain(name);
      expect(pet.body.data.map((p: any) => p.name)).toContain(name);
    });

    it('filters by species independently of segment', async () => {
      const { dog } = await seedMixedCatalogue();

      const res = await http().get(`/api/v1/products?speciesId=${dog.id}`).expect(200);

      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.map((p: any) => p.name).sort()).toEqual([
        'Grain Free Kibble 12kg',
        'Wild Salmon Oil 500ml',
      ]);
    });

    it('combines segment and species, and counts only the intersection', async () => {
      const { dog } = await seedMixedCatalogue();

      const res = await http()
        .get(`/api/v1/products?segments=HUMAN&speciesId=${dog.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].name).toBe('Wild Salmon Oil 500ml');
    });

    it('paginates a segment-filtered listing with a matching total', async () => {
      await seedMixedCatalogue();

      const res = await http()
        .get('/api/v1/products?segments=HUMAN&segments=PET&limit=1')
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta).toEqual({ total: 3, page: 1, limit: 1, pageCount: 3 });
    });

    it('rejects a segment that is not in the enum', async () => {
      await http().get('/api/v1/products?segments=FISH').expect(400);
      await http().get('/api/v1/products?segments=PET&segments=FISH').expect(400);
      await http().get('/api/v1/products?segments=pet').expect(400);
    });
  });

  describe('recursive category filtering', () => {
    // a realistic slice of the tree: product types, not audiences
    //   Dog Food > Puppy Food > Grain Free Puppy
    //   Supplements
    const seedTree = async () => {
      const { token } = await seedUser();
      const vendor = await http()
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Green Valley Nutrition ${(seq += 1)}` })
        .expect(201);
      await approveVendor(vendor.body.id);
      await seedZone(vendor.body.id);

      const cat = (name: string, slug: string, parentId?: string) =>
        prisma.category.create({ data: { name, slug, parentId } });

      const dogFood = await cat('Dog Food', `dog-food-${seq}`);
      const puppyFood = await cat('Puppy Food', `puppy-food-${seq}`, dogFood.id);
      const grainFree = await cat('Grain Free Puppy', `grain-free-puppy-${seq}`, puppyFood.id);
      const supplements = await cat('Supplements', `supplements-${seq}`);

      const make = async (name: string, categoryId: string) => {
        const res = await http()
          .post('/api/v1/products')
          .set('Authorization', `Bearer ${token}`)
          .send({
            name, price: 1000, stock: 5, vendorId: vendor.body.id,
            segments: ['PET'], categoryId,
          })
          .expect(201);
        return res.body;
      };

      return {
        token,
        dogFood,
        puppyFood,
        grainFree,
        supplements,
        adultKibble: await make('Adult Kibble 12kg', dogFood.id),
        puppyKibble: await make('Puppy Kibble 4kg', puppyFood.id),
        grainFreeKibble: await make('Grain Free Puppy Kibble 4kg', grainFree.id),
        jointCare: await make('Joint Care Chews', supplements.id),
      };
    };

    it('includes every descendant of the chosen category', async () => {
      const { dogFood } = await seedTree();

      const res = await http()
        .get(`/api/v1/products?categoryId=${dogFood.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.map((p: any) => p.name).sort()).toEqual([
        'Adult Kibble 12kg',
        'Grain Free Puppy Kibble 4kg',
        'Puppy Kibble 4kg',
      ]);
    });

    it('reaches a grandchild, not just direct children', async () => {
      const { puppyFood } = await seedTree();

      const res = await http()
        .get(`/api/v1/products?categoryId=${puppyFood.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(2);
      expect(res.body.data.map((p: any) => p.name).sort()).toEqual([
        'Grain Free Puppy Kibble 4kg',
        'Puppy Kibble 4kg',
      ]);
    });

    it('returns only its own product for a leaf category', async () => {
      const { grainFree } = await seedTree();

      const res = await http()
        .get(`/api/v1/products?categoryId=${grainFree.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].name).toBe('Grain Free Puppy Kibble 4kg');
    });

    it('does not leak products from a sibling branch', async () => {
      const { supplements } = await seedTree();

      const res = await http()
        .get(`/api/v1/products?categoryId=${supplements.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].name).toBe('Joint Care Chews');
    });

    it('returns an empty page for a category that does not exist', async () => {
      await seedTree();

      const res = await http()
        .get('/api/v1/products?categoryId=no-such-category')
        .expect(200);

      expect(res.body.data).toEqual([]);
      expect(res.body.meta.total).toBe(0);
    });

    it('combines the subtree with the other filters', async () => {
      const { dogFood } = await seedTree();

      const res = await http()
        .get(`/api/v1/products?categoryId=${dogFood.id}&segments=PET&limit=2`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ total: 3, page: 1, limit: 2, pageCount: 2 });
    });

    it('refuses to move a category under its own descendant', async () => {
      const { dogFood, grainFree } = await seedTree();
      const admin = await seedUser({ isAdmin: true });

      await http()
        .patch(`/api/v1/categories/${dogFood.id}`)
        .set('Authorization', `Bearer ${admin.token}`)
        .send({ parentId: grainFree.id })
        .expect(400);
    });

    // UNION rather than UNION ALL is what makes this terminate. Written straight
    // to the database because the API now refuses to create a cycle.
    it('terminates on a cycle instead of hanging', async () => {
      const { dogFood, grainFree } = await seedTree();

      await prisma.category.update({
        where: { id: dogFood.id },
        data: { parentId: grainFree.id },
      });

      const res = await http()
        .get(`/api/v1/products?categoryId=${dogFood.id}`)
        .expect(200);

      expect(res.body.meta.total).toBe(3);
    }, 15000);
  });

  describe('segment hierarchy', () => {
    // POULTRY and AQUACULTURE are kinds of LIVESTOCK. Each product carries the one
    // accurate tag, so only the filter knows about the hierarchy.
    const seedFarmCatalogue = async () => {
      const { token } = await seedUser();
      const vendor = await http()
        .post('/api/v1/vendors')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: `Green Valley Nutrition ${(seq += 1)}` })
        .expect(201);
      await approveVendor(vendor.body.id);
      await seedZone(vendor.body.id);

      const make = async (name: string, segments: string[]) => {
        const res = await http()
          .post('/api/v1/products')
          .set('Authorization', `Bearer ${token}`)
          .send({ name, price: 1000, stock: 5, vendorId: vendor.body.id, segments })
          .expect(201);
        return res.body;
      };

      return {
        mash: await make('Layer Mash 25kg', ['POULTRY']),
        fishFeed: await make('Tilapia Grower Pellets 20kg', ['AQUACULTURE']),
        mineral: await make('Cattle Mineral Lick 5kg', ['LIVESTOCK']),
        ginger: await make('Cold Pressed Ginger Shot 250ml', ['HUMAN']),
      };
    };

    it('includes poultry and aquaculture under LIVESTOCK', async () => {
      await seedFarmCatalogue();

      const res = await http().get('/api/v1/products?segments=LIVESTOCK').expect(200);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data.map((p: any) => p.name).sort()).toEqual([
        'Cattle Mineral Lick 5kg',
        'Layer Mash 25kg',
        'Tilapia Grower Pellets 20kg',
      ]);
    });

    it('keeps a narrow kind narrow', async () => {
      await seedFarmCatalogue();

      const poultry = await http().get('/api/v1/products?segments=POULTRY').expect(200);
      expect(poultry.body.meta.total).toBe(1);
      expect(poultry.body.data[0].name).toBe('Layer Mash 25kg');

      const aqua = await http().get('/api/v1/products?segments=AQUACULTURE').expect(200);
      expect(aqua.body.meta.total).toBe(1);
      expect(aqua.body.data[0].name).toBe('Tilapia Grower Pellets 20kg');
    });

    it('does not leak farm products into HUMAN or PET', async () => {
      await seedFarmCatalogue();

      const human = await http().get('/api/v1/products?segments=HUMAN').expect(200);
      expect(human.body.meta.total).toBe(1);
      expect(human.body.data[0].name).toBe('Cold Pressed Ginger Shot 250ml');

      const pet = await http().get('/api/v1/products?segments=PET').expect(200);
      expect(pet.body.meta.total).toBe(0);
    });

    it('does not double-count when a parent and its kind are both requested', async () => {
      await seedFarmCatalogue();

      const res = await http()
        .get('/api/v1/products?segments=LIVESTOCK&segments=POULTRY')
        .expect(200);

      expect(res.body.meta.total).toBe(3);
      expect(res.body.data).toHaveLength(3);
    });

    it('paginates a widened filter with a matching total', async () => {
      await seedFarmCatalogue();

      const res = await http()
        .get('/api/v1/products?segments=LIVESTOCK&limit=2')
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.meta).toEqual({ total: 3, page: 1, limit: 2, pageCount: 2 });
    });
  });

  describe('vendor listing pagination', () => {
    it('paginates and sorts vendors by name', async () => {
      const { token } = await seedUser();
      for (const name of ['Zebra Feeds', 'Alpha Wellness', 'Mid Valley Produce']) {
        await http()
          .post('/api/v1/vendors')
          .set('Authorization', `Bearer ${token}`)
          .send({ name })
          .expect(201);
      }

      // the public directory lists approved vendors only
      const all = await prisma.vendor.findMany({ select: { id: true } });
      for (const vendor of all) await approveVendor(vendor.id);

      const res = await http().get('/api/v1/vendors?sortBy=name&order=asc&limit=2').expect(200);

      expect(res.body.data.map((v: any) => v.name)).toEqual([
        'Alpha Wellness',
        'Mid Valley Produce',
      ]);
      expect(res.body.meta).toEqual({ total: 3, page: 1, limit: 2, pageCount: 2 });
    });

    it('applies the same validation to the vendor listing', async () => {
      await http().get('/api/v1/vendors?limit=10000').expect(400);
      await http().get('/api/v1/vendors?sortBy=ownerId').expect(400);
    });
  });


});
