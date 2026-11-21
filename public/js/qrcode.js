// Self-contained QR Code SVG generator (ISO/IEC 18004 Byte Mode, Error Correction Level M, Versions 1-6)
(function (global) {
  'use strict';

  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) {
      EXP[i] = EXP[i - 255];
    }
  })();

  function gfMul(a, b) {
    return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]];
  }

  function polyMul(p, q) {
    const r = new Uint8Array(p.length + q.length - 1);
    for (let i = 0; i < p.length; i++) {
      for (let j = 0; j < q.length; j++) {
        r[i + j] ^= gfMul(p[i], q[j]);
      }
    }
    return r;
  }

  function rsGeneratorPoly(degree) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < degree; i++) {
      g = polyMul(g, new Uint8Array([1, EXP[i]]));
    }
    return g;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGeneratorPoly(ecLen);
    const res = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ res[0];
      for (let j = 0; j < ecLen - 1; j++) {
        res[j] = res[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      res[ecLen - 1] = gfMul(gen[ecLen], factor);
    }
    return res;
  }

  // Version specs for Error Correction Level L (high capacity, clean scannable matrix)
  // [totalDataCodewords, ecCodewordsPerBlock, numBlocks, alignmentCenters]
  const VERSION_SPECS = {
    1: { dataBytes: 19, ecBytes: 7, blocks: 1, align: [] },
    2: { dataBytes: 34, ecBytes: 10, blocks: 1, align: [6, 18] },
    3: { dataBytes: 55, ecBytes: 15, blocks: 1, align: [6, 22] },
    4: { dataBytes: 80, ecBytes: 20, blocks: 1, align: [6, 26] },
    5: { dataBytes: 108, ecBytes: 26, blocks: 1, align: [6, 30] },
    6: { dataBytes: 136, ecBytes: 18, blocks: 2, align: [6, 34] }
  };

  function encodeUTF8(str) {
    return new TextEncoder().encode(str);
  }

  function pickVersion(byteLen) {
    for (let v = 1; v <= 6; v++) {
      if (byteLen + 2 <= VERSION_SPECS[v].dataBytes) return v;
    }
    return 6;
  }

  function buildCodewords(bytes, spec) {
    const bits = [];
    function pushBits(val, len) {
      for (let i = len - 1; i >= 0; i--) {
        bits.push((val >> i) & 1);
      }
    }
    // Byte mode indicator (0100)
    pushBits(0b0100, 4);
    pushBits(bytes.length, 8);
    for (let i = 0; i < bytes.length; i++) {
      pushBits(bytes[i], 8);
    }
    const maxBits = spec.dataBytes * 8;
    const terminator = Math.min(4, maxBits - bits.length);
    pushBits(0, terminator);
    while (bits.length % 8 !== 0) bits.push(0);

    const dataCodewords = new Uint8Array(spec.dataBytes);
    let idx = 0;
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      dataCodewords[idx++] = b;
    }
    const pads = [0xec, 0x11];
    let p = 0;
    while (idx < spec.dataBytes) {
      dataCodewords[idx++] = pads[p % 2];
      p++;
    }

    if (spec.blocks === 1) {
      const ec = rsEncode(dataCodewords, spec.ecBytes);
      const all = new Uint8Array(dataCodewords.length + ec.length);
      all.set(dataCodewords, 0);
      all.set(ec, dataCodewords.length);
      return all;
    } else {
      const blockSize = spec.dataBytes / spec.blocks;
      const dBlocks = [];
      const eBlocks = [];
      for (let b = 0; b < spec.blocks; b++) {
        const slice = dataCodewords.slice(b * blockSize, (b + 1) * blockSize);
        dBlocks.push(slice);
        eBlocks.push(rsEncode(slice, spec.ecBytes));
      }
      const all = [];
      for (let i = 0; i < blockSize; i++) {
        for (let b = 0; b < spec.blocks; b++) all.push(dBlocks[b][i]);
      }
      for (let i = 0; i < spec.ecBytes; i++) {
        for (let b = 0; b < spec.blocks; b++) all.push(eBlocks[b][i]);
      }
      return new Uint8Array(all);
    }
  }

  function createMatrix(version, codewords) {
    const size = version * 4 + 17;
    const modules = Array.from({ length: size }, () => new Int8Array(size));
    const isFunction = Array.from({ length: size }, () => new Uint8Array(size));

    function setFunctionModule(r, c, dark) {
      if (r < 0 || r >= size || c < 0 || c >= size) return;
      modules[r][c] = dark ? 1 : 0;
      isFunction[r][c] = 1;
    }

    function drawFinder(r, c) {
      for (let dy = -1; dy <= 7; dy++) {
        for (let dx = -1; dx <= 7; dx++) {
          const rr = r + dy, cc = c + dx;
          if (rr < 0 || rr >= size || cc < 0 || cc >= size) continue;
          const inOuter = (dx >= 0 && dx <= 6 && (dy === 0 || dy === 6)) || (dy >= 0 && dy <= 6 && (dx === 0 || dx === 6));
          const inInner = dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
          setFunctionModule(rr, cc, inOuter || inInner);
        }
      }
    }

    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      setFunctionModule(6, i, i % 2 === 0);
      setFunctionModule(i, 6, i % 2 === 0);
    }

    // Alignment patterns
    const align = VERSION_SPECS[version].align;
    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < align.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === align.length - 1) || (i === align.length - 1 && j === 0)) continue;
        const cr = align[i], cc = align[j];
        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            setFunctionModule(cr + dy, cc + dx, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
          }
        }
      }
    }

    // Reserve format info & dark module
    for (let i = 0; i <= 8; i++) {
      if (i !== 6) {
        setFunctionModule(8, i, false);
        setFunctionModule(i, 8, false);
      }
    }
    for (let i = 0; i < 8; i++) {
      setFunctionModule(8, size - 1 - i, false);
      setFunctionModule(size - 1 - i, 8, false);
    }
    setFunctionModule(size - 8, 8, true);

    // Place data bits
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let j = 0; j < 2; j++) {
          const c = right - j;
          if (!isFunction[r][c]) {
            let dark = false;
            if (bitIdx < totalBits) {
              dark = ((codewords[bitIdx >> 3] >> (7 - (bitIdx & 7))) & 1) !== 0;
              bitIdx++;
            }
            // Apply mask 0: (r + c) % 2 === 0
            if ((r + c) % 2 === 0) dark = !dark;
            modules[r][c] = dark ? 1 : 0;
          }
        }
      }
      upward = !upward;
    }

    // Format info for Level L (01) and Mask 0 (000) -> precomputed BCH bits: 0b111011111000100 (0x77c4)
    const formatBits = 0x77c4;
    function getFormatBit(i) {
      return ((formatBits >> i) & 1) !== 0;
    }
    for (let i = 0; i <= 5; i++) setFunctionModule(8, i, getFormatBit(i));
    setFunctionModule(8, 7, getFormatBit(6));
    setFunctionModule(8, 8, getFormatBit(7));
    setFunctionModule(7, 8, getFormatBit(8));
    for (let i = 9; i < 15; i++) setFunctionModule(14 - i, 8, getFormatBit(i));

    for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, getFormatBit(i));
    for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, getFormatBit(i));
    setFunctionModule(size - 8, 8, true);

    return modules;
  }

  function generateQRCodeSVG(text, options = {}) {
    const bytes = encodeUTF8(text);
    const version = pickVersion(bytes.length);
    const spec = VERSION_SPECS[version];
    const codewords = buildCodewords(bytes, spec);
    const matrix = createMatrix(version, codewords);
    const size = matrix.length;
    const margin = options.margin !== undefined ? options.margin : 2;
    const total = size + margin * 2;
    const darkColor = options.darkColor || '#0f172a';
    const lightColor = options.lightColor || '#ffffff';

    let pathData = '';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (matrix[r][c]) {
          const x = c + margin;
          const y = r + margin;
          pathData += `M${x},${y}h1v1h-1z`;
        }
      }
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" width="100%" height="100%">
      <rect width="${total}" height="${total}" fill="${lightColor}" rx="1.5"/>
      <path d="${pathData}" fill="${darkColor}"/>
    </svg>`;
  }

  global.QRCodeGenerator = {
    toSVG: generateQRCodeSVG
  };
})(window);

