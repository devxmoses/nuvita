/**
 * Empty the in-memory throttler between tests.
 *
 * The global limit is 100 requests/minute keyed on IP, so every request in one
 * spec file shares a bucket. Without resetting it the suite starts 429ing
 * partway down, which says nothing about the code under test.
 *
 * There is no public API for this, so it reaches into the storage service - but
 * it does so by SHAPE rather than by field name. @nestjs/throttler 6.5 kept the
 * counts in a single `_storage` Map; 6.8 added a second `hitExpirations` Map and
 * counts hits from that too, so clearing `_storage` by name stopped working and
 * the old `throttlerStorage?._storage?.clear?.()` silently did nothing - every
 * optional-chain link swallowed the change and the symptom was confusing 429s.
 *
 * Clearing every Map on the service survives that kind of refactor. The throw is
 * the important half: if a future version stops using Maps, this fails loudly
 * here instead of leaving a whole suite mysteriously rate limited.
 */
export const resetThrottler = (storage: unknown): void => {
    let cleared = 0;

    for (const value of Object.values(storage as Record<string, unknown>)) {
        if (value instanceof Map) {
            value.clear();
            cleared += 1;
        }
    }

    if (cleared === 0) {
        throw new Error(
            'resetThrottler found no Map on the throttler storage service. Its internals ' +
            'have changed; update this helper, or the suite will 429 for no reason.',
        );
    }
};
