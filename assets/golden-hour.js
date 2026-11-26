// Golden hour picker on the sunset guide. The sun times are worked out in the browser with the
// NOAA solar formulas, so nothing is sent anywhere and nothing is saved.
(() => {
  const box = document.getElementById('sunPicker');
  if (!box) return;
  const place = document.getElementById('sunPlace');
  const date = document.getElementById('sunDate');
  const show = (id, text) => { document.getElementById(id).textContent = text; };
  const rad = Math.PI / 180;
  const MIN = 60000;

  // Solar declination (radians) and equation of time (minutes) at a UTC timestamp.
  function sun(ms) {
    const T = (ms / 86400000 + 2440587.5 - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(M * rad) * (1.914602 - T * (0.004817 + 0.000014 * T))
      + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * T) + Math.sin(3 * M * rad) * 0.000289;
    const omega = 125.04 - 1934.136 * T;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(omega * rad);
    const y = Math.tan(eps * rad / 2) ** 2;
    return {
      dec: Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad)),
      eqt: 4 / rad * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad)
        - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad))
    };
  }

  // When the centre of the sun sinks to `alt` degrees on the evening of a local date, as a UTC
  // timestamp, or null if it never gets that low.
  function evening(y, m, d, lat, lon, alt) {
    const day = Date.UTC(y, m - 1, d);
    let t = day + (720 - 4 * lon) * MIN;
    for (let i = 0; i < 3; i++) {
      const { dec, eqt } = sun(t);
      const cosH = (Math.sin(alt * rad) - Math.sin(lat * rad) * Math.sin(dec)) / (Math.cos(lat * rad) * Math.cos(dec));
      if (cosH < -1 || cosH > 1) return null;
      t = day + (720 - 4 * lon - eqt + 4 * Math.acos(cosH) / rad) * MIN;
    }
    return t;
  }

  // "6:40" and "p.m." in the venue's time zone, to the nearest minute.
  function clock(t, tz) {
    const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz })
      .formatToParts(new Date(Math.round(t / MIN) * MIN));
    const get = (type) => (parts.find((p) => p.type === type) || {}).value || '';
    return { hm: `${get('hour')}:${get('minute')}`, ap: get('dayPeriod').toLowerCase().startsWith('a') ? 'a.m.' : 'p.m.' };
  }
  const at = (t, tz) => { const c = clock(t, tz); return `${c.hm} ${c.ap}`; };
  const span = (a, b, tz) => {
    const x = clock(a, tz), z = clock(b, tz);
    return x.ap === z.ap ? `${x.hm} to ${z.hm} ${z.ap}` : `${x.hm} ${x.ap} to ${z.hm} ${z.ap}`;
  };

  function update() {
    const opt = place.selectedOptions[0];
    const [y, m, d] = (date.value || '').split('-').map(Number);
    if (!opt || !y || !m || !d) return;
    const lat = Number(opt.dataset.lat), lon = Number(opt.dataset.lon), tz = opt.dataset.tz || 'America/Los_Angeles';
    show('sunDay', new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
      .format(new Date(Date.UTC(y, m - 1, d, 12))) + ' in ' + opt.textContent.replace(/\s*\(.*\)$/, ''));
    const set = evening(y, m, d, lat, lon, -0.833);
    const gold = evening(y, m, d, lat, lon, 6);
    const dusk = evening(y, m, d, lat, lon, -6);
    if (set === null || gold === null || dusk === null) {
      for (const id of ['sunGolden', 'sunStep', 'sunSet', 'sunBlue']) show(id, 'Not available for this date');
      return;
    }
    const step = Math.floor(gold / (5 * MIN)) * 5 * MIN;
    show('sunGolden', span(gold, set, tz));
    show('sunStep', span(step, step + 20 * MIN, tz));
    show('sunSet', at(set, tz));
    show('sunBlue', span(set, dusk, tz));
  }

  const today = new Date();
  date.value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  place.addEventListener('change', update);
  date.addEventListener('input', update);
  date.addEventListener('change', update);
  box.hidden = false;
  update();
})();
