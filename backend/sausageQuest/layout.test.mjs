import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { generateCollectibles } = require('./layout');
const source = fs.readFileSync(new URL('../../frontend/src/sausage-quest/game.js', import.meta.url), 'utf8');
// Execute the game's actual unmodified layout-generation section with render
// stubs; compare against the server verifier across seeds and difficulties.
const rng = source.slice(source.indexOf('rng=s=>'), source.indexOf('let LV;')).replace(/;\s*$/, '');
const build = source.slice(source.indexOf('function build(i){'), source.indexOf('G.push([x,L+16])'));
const sandbox = vm.createContext({});
vm.runInContext(`
  const ${rng};
  let LV,LG,lv,solids,spikes,barrels,saus,CP,cpI,cpObj;
  const scene={remove(){},add(){}},THREE={Group:class{},Color:class{r=1;g=1;b=1}};
  const BIO={city:{}};
  function clearE(){}
  ${build} return saus; }
  globalThis.collectibles=descriptor=>{
    LV=[{L:descriptor.length,seed:descriptor.seed,haz:descriptor.hazard,bio:'city',bld:[0]}];
    return build(0);
  };
`, sandbox);

test('server collectible positions exactly match the supplied game across generated layouts', () => {
  for (const index of [0, 1, 2]) {
    for (let seed = 0; seed < 100; seed++) {
      const descriptor = { seed: seed * 93817, length: [130, 175, 220][index] + seed % 30 - 10, hazard: [.35, .6, .85][index] + .05 };
      const expected = JSON.parse(JSON.stringify(sandbox.collectibles(descriptor)));
      assert.deepEqual(generateCollectibles(descriptor), expected, `layout ${index}:${seed}`);
    }
  }
});
