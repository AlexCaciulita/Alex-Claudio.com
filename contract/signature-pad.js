// A box to sign in with a finger, a pen or the mouse, or to type a name into instead. Hands back
// the signature as a PNG data address. Used on the couple's contract page and in the dashboard.
(function (root) {
  'use strict';

  function SignaturePad(options = {}) {
    const width = options.width || 560;
    const height = options.height || 180;
    const wrap = document.createElement('div');
    wrap.className = 'sig-pad';
    const canvas = document.createElement('canvas');
    canvas.className = 'sig-canvas';
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', options.label || 'Signature box. Draw your signature here, or choose Type it instead.');
    const ratio = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    const ctx = canvas.getContext('2d');
    ctx.scale(ratio, ratio);
    const line = document.createElement('span');
    line.className = 'sig-line';
    line.setAttribute('aria-hidden', 'true');
    const typed = document.createElement('input');
    typed.type = 'text';
    typed.className = 'sig-typed';
    typed.maxLength = 80;
    typed.placeholder = 'Type your name';
    typed.setAttribute('aria-label', 'Type your signature');
    typed.hidden = true;
    const tools = document.createElement('div');
    tools.className = 'sig-tools';
    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = 'Clear';
    const modeButton = document.createElement('button');
    modeButton.type = 'button';
    modeButton.textContent = 'Type it instead';
    tools.append(clearButton, modeButton);
    wrap.append(canvas, line, typed, tools);

    let strokes = 0;
    let drawing = false;
    let mode = 'draw';
    const ink = options.ink || '#171412';
    const blank = () => { ctx.clearRect(0, 0, width, height); strokes = 0; };
    const point = (event) => {
      const box = canvas.getBoundingClientRect();
      return { x: ((event.clientX - box.left) / box.width) * width, y: ((event.clientY - box.top) / box.height) * height };
    };
    canvas.addEventListener('pointerdown', (event) => {
      if (mode !== 'draw') return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      drawing = true;
      const p = point(event);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + 0.1, p.y + 0.1);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
    });
    canvas.addEventListener('pointermove', (event) => {
      if (!drawing) return;
      event.preventDefault();
      const p = point(event);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    });
    const end = () => {
      if (!drawing) return;
      drawing = false;
      strokes += 1;
      if (options.onChange) options.onChange();
    };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('pointerleave', end);

    // A typed name is written into the box in a script-like italic, so both kinds come out as an image.
    const writeTyped = () => {
      blank();
      const name = typed.value.trim();
      if (!name) return;
      let size = 46;
      ctx.fillStyle = ink;
      ctx.textBaseline = 'alphabetic';
      do {
        ctx.font = `italic 400 ${size}px Fraunces, Georgia, serif`;
        size -= 2;
      } while (ctx.measureText(name).width > width - 40 && size > 16);
      ctx.fillText(name, 20, height - 52);
      strokes = 1;
    };
    typed.addEventListener('input', () => { writeTyped(); if (options.onChange) options.onChange(); });

    clearButton.addEventListener('click', () => { blank(); typed.value = ''; if (options.onChange) options.onChange(); });
    modeButton.addEventListener('click', () => {
      mode = mode === 'draw' ? 'type' : 'draw';
      typed.hidden = mode === 'draw';
      modeButton.textContent = mode === 'draw' ? 'Type it instead' : 'Draw it instead';
      canvas.classList.toggle('is-typed', mode === 'type');
      blank();
      typed.value = '';
      if (mode === 'type') typed.focus();
      if (options.onChange) options.onChange();
    });

    return {
      element: wrap,
      isEmpty: () => strokes === 0,
      // A trimmed copy of what's in the box, so the stored image holds only the signature.
      toDataURL() {
        if (!strokes) return null;
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let top = canvas.height; let left = canvas.width; let right = 0; let bottom = 0;
        for (let y = 0; y < canvas.height; y += 1) {
          for (let x = 0; x < canvas.width; x += 1) {
            if (data[(y * canvas.width + x) * 4 + 3] > 8) {
              if (x < left) left = x;
              if (x > right) right = x;
              if (y < top) top = y;
              if (y > bottom) bottom = y;
            }
          }
        }
        if (right <= left || bottom <= top) return null;
        const pad = 8 * ratio;
        const out = document.createElement('canvas');
        out.width = Math.min(canvas.width, right - left + pad * 2);
        out.height = Math.min(canvas.height, bottom - top + pad * 2);
        out.getContext('2d').drawImage(canvas, Math.max(0, left - pad), Math.max(0, top - pad), out.width, out.height, 0, 0, out.width, out.height);
        return out.toDataURL('image/png');
      },
      clear: blank
    };
  }

  root.SignaturePad = SignaturePad;
}(typeof self !== 'undefined' ? self : this));
