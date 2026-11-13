// Look and theme boot, loaded in <head> after looks.css so a saved look never flashes the default one.
// Same system as the CF Archive and Solar Sponge: '' is this site's own look, the rest come from looks.css.
// The name is checked against a fixed list, so nothing read from storage reaches an attribute or a URL unchecked.
// Adds a "Look" picker and a light/dark button to the page header, and fires "mwi:look" on window when the look
// or theme changes or its fonts arrive, so the chart (drawn on a canvas) can redraw.
(function () {
  const LOOKS = { '': 'Milky Way', ledger: 'Ledger', almanac: 'Almanac', telnet: 'Telnet', report: 'Field Report', dash: 'Dashboard', tome: 'Tome',
    vhs: 'Retro VHS', liquid: 'Liquid Morph', neon: 'Neon Glow', chrome: 'Y2K Chrome', holo: 'Holographic', paper: 'Paper Cutout', iso: 'Isometric',
    ascii: 'ASCII Art', comic: 'Comic Book', blueprint: 'Blueprint', pixel: 'Pixel Art', brutal: 'Neo-Brutalism', particles: 'Particles',
    kinetic: 'Kinetic Type', clay: 'Clay 3D', flap: 'Split-Flap', sketch: 'Hand-Drawn', physics: 'Physics', bauhaus: 'Bauhaus', deco: 'Art Deco',
    wasteland: 'Wasteland Terminal' };
  const FONTS = { // Google Fonts families per look, loaded only when that look is chosen
    ledger: 'IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Serif:wght@600',
    dash: 'Plus+Jakarta+Sans:wght@400;500;600;700;800',
    tome: 'Cinzel:wght@500;700&family=IM+Fell+English:ital@0;1&family=UnifrakturCook:wght@700',
    vhs: 'VT323&family=Share+Tech+Mono', liquid: 'Syne:wght@400;600;700;800', neon: 'Tilt+Neon',
    chrome: 'Orbitron:wght@500;700;900&family=Exo+2:wght@400;600', holo: 'Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700',
    paper: 'Patrick+Hand&family=Nunito:wght@400;600;700', iso: 'Rubik:wght@400;500;700;800', comic: 'Bangers&family=Comic+Neue:wght@400;700',
    blueprint: 'Architects+Daughter&family=Share+Tech+Mono', pixel: 'Press+Start+2P&family=Pixelify+Sans:wght@400;600',
    particles: 'Outfit:wght@400;600;700', kinetic: 'Anybody:wdth,wght@50..150,100..900', clay: 'Fredoka:wght@400;500;600;700',
    flap: 'Oswald:wght@500;600&family=Roboto+Mono:wght@400;500;700', sketch: 'Caveat:wght@600;700&family=Kalam:wght@400;700',
    physics: 'Lexend:wght@400;600;800', bauhaus: 'Jost:wght@400;500;700;800', wasteland: 'VT323&family=Share+Tech+Mono',
    deco: 'Limelight&family=Josefin+Sans:wght@400;600',
    brutal: 'Archivo+Black&family=Space+Grotesk:wght@400;500;700&family=Space+Mono:wght@400;700',
    report: 'Courier+Prime:wght@400;700&family=Special+Elite&family=Stardos+Stencil:wght@700',
  };
  const root = document.documentElement;
  const get = k => { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } };
  const set = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (e) { } };
  const fire = () => window.dispatchEvent(new Event('mwi:look'));
  const isDark = () => getComputedStyle(root).colorScheme === 'dark';

  const theme = get('mwi.theme');
  if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;

  const ICON = paths => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
  const SUN = ICON('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>');
  const MOON = ICON('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
  let themeBtn = null;
  const syncThemeBtn = () => {
    if (!themeBtn) return;
    const look = root.dataset.look || '';
    themeBtn.hidden = !!look && look !== 'ledger'; // only the default look and Ledger have a light and a dark scheme
    themeBtn.innerHTML = isDark() ? SUN : MOON; // fixed markup above, nothing from storage
    themeBtn.title = `Switch to ${isDark() ? 'light' : 'dark'} theme`;
    themeBtn.setAttribute('aria-label', themeBtn.title);
  };

  function setLook(look, save) {
    if (!(look in LOOKS)) look = '';
    if (look) root.dataset.look = look; else delete root.dataset.look;
    if (FONTS[look] && !document.getElementById('lookfont-' + look)) {
      const l = document.createElement('link');
      l.rel = 'stylesheet'; l.id = 'lookfont-' + look; l.href = 'https://fonts.googleapis.com/css2?family=' + FONTS[look] + '&display=swap';
      l.onload = () => document.fonts.ready.then(fire);
      document.head.appendChild(l);
    }
    syncThemeBtn();
    if (save) { set('mwi.look', look); fire(); }
    return look;
  }
  setLook(get('mwi.look'), false);

  document.addEventListener('DOMContentLoaded', () => {
    const header = document.querySelector('header'); if (!header) return;
    themeBtn = document.createElement('button');
    themeBtn.className = 'btn icon'; themeBtn.id = 'themeBtn';
    themeBtn.onclick = () => { const next = isDark() ? 'light' : 'dark'; root.dataset.theme = next; set('mwi.theme', next); syncThemeBtn(); fire(); };
    const label = document.createElement('label'); label.className = 'look';
    const select = document.createElement('select');
    for (const [value, text] of Object.entries(LOOKS)) select.add(new Option(text, value));
    select.value = root.dataset.look || '';
    select.onchange = () => { select.value = setLook(select.value, true); };
    label.append('Look', select);
    header.append(label, themeBtn);
    syncThemeBtn();
  });
})();
