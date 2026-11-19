// Dot-matrix type + halftone art, in the spirit of Nothing's NDot / Glyph look.
(function () {
  const G = {
    '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    '1': ['010', '110', '010', '010', '010', '010', '111'],
    '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
    '3': ['11111', '00010', '00100', '00010', '00001', '10001', '01110'],
    '4': ['00010', '00110', '01010', '10010', '11111', '00010', '00010'],
    '5': ['11111', '10000', '11110', '00001', '00001', '10001', '01110'],
    '6': ['00110', '01000', '10000', '11110', '10001', '10001', '01110'],
    '7': ['11111', '00001', '00010', '00100', '01000', '01000', '01000'],
    '8': ['01110', '10001', '10001', '01110', '10001', '10001', '01110'],
    '9': ['01110', '10001', '10001', '01111', '00001', '00010', '01100'],
    'A': ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    'B': ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
    'C': ['01110', '10001', '10000', '10000', '10000', '10001', '01110'],
    'D': ['11100', '10010', '10001', '10001', '10001', '10010', '11100'],
    'E': ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    'F': ['11111', '10000', '10000', '11110', '10000', '10000', '10000'],
    'G': ['01110', '10001', '10000', '10111', '10001', '10001', '01111'],
    'H': ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    'I': ['111', '010', '010', '010', '010', '010', '111'],
    'J': ['00111', '00010', '00010', '00010', '00010', '10010', '01100'],
    'K': ['10001', '10010', '10100', '11000', '10100', '10010', '10001'],
    'L': ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
    'M': ['10001', '11011', '10101', '10101', '10001', '10001', '10001'],
    'N': ['10001', '10001', '11001', '10101', '10011', '10001', '10001'],
    'O': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    'P': ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    'Q': ['01110', '10001', '10001', '10001', '10101', '10010', '01101'],
    'R': ['11110', '10001', '10001', '11110', '10100', '10010', '10001'],
    'S': ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    'T': ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    'U': ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    'V': ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
    'W': ['10001', '10001', '10001', '10101', '10101', '10101', '01010'],
    'X': ['10001', '10001', '01010', '00100', '01010', '10001', '10001'],
    'Y': ['10001', '10001', '10001', '01010', '00100', '00100', '00100'],
    'Z': ['11111', '00001', '00010', '00100', '01000', '10000', '11111'],
    ' ': ['000', '000', '000', '000', '000', '000', '000'],
    ':': ['0', '0', '1', '0', '1', '0', '0'],
    '.': ['0', '0', '0', '0', '0', '0', '1'],
    '-': ['000', '000', '000', '111', '000', '000', '000'],
    '+': ['000', '000', '010', '111', '010', '000', '000'],
    '%': ['11000', '11001', '00010', '00100', '01000', '10011', '00011'],
    '°': ['010', '101', '010', '000', '000', '000', '000'],
    "'": ['1', '1', '0', '0', '0', '0', '0'],
    '/': ['00001', '00010', '00010', '00100', '01000', '01000', '10000'],
  };

  /**
   * Render text as an SVG string of dots.
   * opts: dot (diameter px), gap (px between dots), color, ghost (opacity of unlit dots, 0 = hidden)
   */
  function text(str, opts = {}) {
    const dot = opts.dot || 3;
    const gap = opts.gap == null ? dot * 0.45 : opts.gap;
    const color = opts.color || 'currentColor';
    const ghost = opts.ghost || 0;
    const step = dot + gap;
    const chars = String(str).toUpperCase().split('').map((c) => G[c] || G[' ']);
    let col = 0;
    let circles = '';
    chars.forEach((g, ci) => {
      const w = g[0].length;
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < w; x++) {
          const on = g[y][x] === '1';
          if (!on && !ghost) continue;
          const cx = (col + x) * step + dot / 2;
          const cy = y * step + dot / 2;
          circles += `<circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(dot / 2).toFixed(2)}"${on ? '' : ` opacity="${ghost}"`}/>`;
        }
      }
      col += w + (ci < chars.length - 1 ? 1 : 0);
    });
    const width = Math.max(0, col * step - gap);
    const height = 7 * step - gap;
    return `<svg class="dm" width="${width.toFixed(1)}" height="${height.toFixed(1)}" viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" fill="${color}" xmlns="http://www.w3.org/2000/svg">${circles}</svg>`;
  }

  /** Draw an image as a halftone dot grid onto a canvas (Nothing-style album art). */
  function halftone(canvas, img, cols, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || canvas.width;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = opts.bg || '#000';
    ctx.fillRect(0, 0, size, size);

    const off = document.createElement('canvas');
    off.width = cols; off.height = cols;
    const octx = off.getContext('2d', { willReadFrequently: true });
    // cover-crop to square
    const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
    const sx = ((img.naturalWidth || img.width) - s) / 2;
    const sy = ((img.naturalHeight || img.height) - s) / 2;
    octx.drawImage(img, sx, sy, s, s, 0, 0, cols, cols);
    const px = octx.getImageData(0, 0, cols, cols).data;

    const cell = size / cols;
    for (let y = 0; y < cols; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        const r = px[i], g = px[i + 1], b = px[i + 2];
        let lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        lum = Math.pow(lum, 0.85);
        const rad = (cell / 2) * 0.92 * lum;
        if (rad < 0.35) continue;
        // keep strong reds red, like Nothing's accent
        const isRed = r > 150 && r > g * 1.8 && r > b * 1.8;
        ctx.fillStyle = isRed ? '#d71921' : (opts.fg || '#fff');
        ctx.beginPath();
        ctx.arc(x * cell + cell / 2, y * cell + cell / 2, rad, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  /** Placeholder art: a dot-matrix music note. */
  function placeholder(canvas, opts = {}) {
    const note = [
      '0000011110',
      '0000111110',
      '0000110010',
      '0000100010',
      '0000100010',
      '0000100010',
      '0011100110',
      '0111101110',
      '0111001100',
      '0000000000',
    ];
    const dpr = window.devicePixelRatio || 1;
    const size = canvas.clientWidth || canvas.width;
    canvas.width = size * dpr; canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = opts.bg || '#000';
    ctx.fillRect(0, 0, size, size);
    const pad = size * 0.16;
    const cell = (size - pad * 2) / 10;
    for (let y = 0; y < 10; y++) {
      for (let x = 0; x < 10; x++) {
        const on = note[y][x] === '1';
        ctx.fillStyle = on ? (opts.fg || '#fff') : 'rgba(255,255,255,0.07)';
        ctx.beginPath();
        ctx.arc(pad + x * cell + cell / 2, pad + y * cell + cell / 2, cell * 0.36, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  window.DotMatrix = { text, halftone, placeholder };
})();
