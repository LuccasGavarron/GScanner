import { $ } from './api.js';
import { initMap, resizeMap } from './map.js';
import { initAmmo } from './ammo.js';
import { initBuild } from './build.js';
import { initPrice } from './price.js';
import { initSound } from './soundtab.js';
import { initMissions } from './missions.js';

// Abas
for (const b of document.querySelectorAll('nav button')) {
  b.onclick = () => {
    document.querySelectorAll('nav button, .tab').forEach(e => e.classList.remove('on'));
    b.classList.add('on');
    $('#' + b.dataset.tab).classList.add('on');
    resizeMap();
  };
}

initMap();
initAmmo();
initBuild();
initPrice();
initSound();
initMissions();
