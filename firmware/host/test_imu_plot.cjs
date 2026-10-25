// Exercise the actual graph script with raw, updated, missing, and stale data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'imu_live.py'), 'utf8');
const script = source.match(/<script>([\s\S]*?)<\/script>/)[1];
const nodes = new Map();
const context = new Proxy({}, {
  get(target, key) {
    if (!(key in target)) target[key] = (...args) => {
      for (const value of args) {
        if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key}: invalid graph coordinate`);
      }
    };
    return target[key];
  },
});
const document = { getElementById(id) {
  if (!nodes.has(id)) nodes.set(id, { value: '20', width: 1200, height: 300,
    textContent: '', className: '', getContext: () => context });
  return nodes.get(id);
} };
const empty = { status: 'Waiting', samples: [], last_sample_age_s: null,
  settings: { on_g: 0.08, off_g: 0.035 } };
const sandbox = vm.createContext({ document, fetch: async () => ({ json: async () => empty }), setTimeout: () => {} });
vm.runInContext(script, sandbox);
const raw = { t: 1000, ax: 0.1, ay: 0, az: 1, gx: 0, gy: 0, gz: 0, metrics: false };
const extended = { ...raw, metrics: true, linear_g: 0.1, average_g: 0.1,
  delta_v_mps: 0.2942, ready: 1, braking: 1, rotation_blocked: 0 };
for (const [sample, age, expected] of [
  [null, null, 'No live data'], [raw, 0.1, 'Raw IMU only'],
  [extended, 0.1, 'BRAKE ON'], [extended, 2, 'No live data'],
  [{ ...extended, ready: 0, braking: 0 }, 0.1, 'Keep still: calibrating'],
  [{ ...extended, rotation_blocked: 1, braking: 0 }, 0.1, 'Head movement'],
  [{ ...extended, braking: 0 }, 0.1, 'Released'],
]) {
  sandbox.payload = { ...empty, samples: sample ? [sample] : [], last_sample_age_s: age };
  vm.runInContext('render(payload)', sandbox);
  assert.equal(nodes.get('brake').textContent, expected);
}
console.log('IMU graph rendering checks passed');
