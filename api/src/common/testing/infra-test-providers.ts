import { EventEmitter2 } from '@nestjs/event-emitter';
import { CacheService } from '../../cache/cache.service';

// A cache that always misses. wrapList/wrapItem run the factory and return it
// untouched, so every existing assertion about what the service queried still
// holds - caching is transparent to the tests rather than something each one has
// to reason about. A test that cares about caching asserts on these mocks.
export const cacheServiceMock = () => ({
    wrapList: jest.fn((_ns: unknown, _query: unknown, _ttl: number, factory: () => unknown) =>
        factory(),
    ),
    wrapItem: jest.fn((_ns: unknown, _id: string, _ttl: number, factory: () => unknown) =>
        factory(),
    ),
    invalidate: jest.fn().mockResolvedValue(undefined),
});

// Listeners are out of scope for a service unit test; what matters is that the
// service emitted the right event with the right payload, which this records.
export const eventEmitterMock = () => ({
    emit: jest.fn().mockReturnValue(true),
    emitAsync: jest.fn().mockResolvedValue([]),
});

export type CacheServiceMock = ReturnType<typeof cacheServiceMock>;
export type EventEmitterMock = ReturnType<typeof eventEmitterMock>;

// Spread into a TestingModule's providers for any service that now depends on the
// infrastructure layer.
export const infraProviders = (
    cache: CacheServiceMock = cacheServiceMock(),
    events: EventEmitterMock = eventEmitterMock(),
) => [
    { provide: CacheService, useValue: cache },
    { provide: EventEmitter2, useValue: events },
];
