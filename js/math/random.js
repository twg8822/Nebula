// Seeded PRNG so every galaxy is reproducible from its seed.
// The implementation lives in src/math.js (unit-tested in tests/math.test.js).

export { mulberry32, createRng } from '../../src/math.js';
