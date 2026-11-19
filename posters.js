/* Self-contained, deterministic studio renders for the invitation covers. */
(() => {
  "use strict";
  const TAU = Math.PI * 2;
  const cache = new Map();
  const width = 540;
  const height = 480;
  const norm = ([x, y, z]) => {
    const length = Math.hypot(x, y, z) || 1;
    return [x / length, y / length, z / length];
  };
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const sub = (a, b) => a.map((n, i) => n - b[i]);

  function tilt(p, x, y, z) {
    let [a, b, c] = p;
    [b, c] = [b * Math.cos(x) - c * Math.sin(x), b * Math.sin(x) + c * Math.cos(x)];
    [a, c] = [a * Math.cos(y) + c * Math.sin(y), -a * Math.sin(y) + c * Math.cos(y)];
    return [a * Math.cos(z) - b * Math.sin(z), a * Math.sin(z) + b * Math.cos(z), c];
  }

  // An extruded, twisted band. A rounded superellipse preserves both flat
  // reflective faces and a narrow polished edge through the twist.
  function ribbon(u, v) {
    const center = 0.94 + 0.14 * Math.cos(3 * u + .35);
    const wave = .27 * Math.sin(2 * u - .25);
    const twist = 1.5 * u + .62;
    const rounded = n => Math.sign(n) * Math.pow(Math.abs(n), .66);
    const a = .39 * rounded(Math.cos(v));
    const b = .22 * rounded(Math.sin(v));
    const radius = center + a * Math.cos(twist) - b * Math.sin(twist);
    return tilt([radius * Math.cos(u), radius * Math.sin(u), wave + a * Math.sin(twist) + b * Math.cos(twist)], .72, -.28, -.49);
  }

  function paper(u, v) {
    // Accordion folds have distinct plane normals on either side of each ridge.
    const t = v / TAU;
    const pleat = Math.acos(Math.cos(17 * u)) / Math.PI;
    const angle = u + .47 * (1 - t);
    const radius = (.31 + .88 * t) * (1 + .10 * Math.cos(3 * u - .4)) + .055 * pleat;
    const z = (.05 + .31 * t) * (2 * pleat - 1) + .29 * Math.sin(2 * u - .6) * t - .28 * (1 - t);
    return tilt([radius * Math.cos(angle), radius * Math.sin(angle), z], .70, -.30, -.56);
  }

  function orbit(u, v, ring) {
    const r = .55 + ring * .16;
    const section = .073 + .010 * ring;
    const radius = r + section * Math.cos(v);
    return tilt([radius * Math.cos(u), radius * Math.sin(u), section * Math.sin(v) + (ring - 2) * .058],
      .43 + .13 * ring, .29 - .18 * ring, -.76 + ring * .10);
  }

  // An environment with strip softboxes on two walls and a large overhead
  // diffuser. Each point samples that environment with its reflected view ray.
  function metal(normal, isGreen, u, v) {
    let [x, y, z] = normal;
    if (z < 0) { x = -x; y = -y; z = -z; }
    const rx = 2 * z * x, ry = 2 * z * y, rz = 2 * z * z - 1;
    const soft = Math.max(0, .22 + .71 * ry + .32 * rx + .43 * rz);
    const strip = Math.exp(-Math.pow((ry - .46 * rx - .22) / .14, 2)) * (.62 + .38 * Math.max(0, -rx));
    const strip2 = Math.exp(-Math.pow((rx + .42 * rz + .48) / .19, 2)) * (.4 + .6 * Math.max(0, ry));
    const rim = Math.pow(1 - z, 2.4);
    const silk = .5 + .5 * Math.cos(47 * v + 1.1 * Math.sin(2 * u));
    const detail = .96 - .13 * Math.pow(silk, 5) + .045 * Math.cos(94 * v);
    const broad = (.28 + .72 * soft + .23 * rim) * detail;
    const shine = Math.min(.95, .12 * soft + .66 * strip + .53 * strip2 + .26 * rim);
    const base = isGreen ? [43, 163, 148] : [144, 114, 240];
    const light = isGreen ? [224, 255, 222] : [249, 235, 255];
    return base.map((channel, i) => channel * broad * (1 - shine * .48) + light[i] * shine);
  }

  function paperTone(normal, u, t) {
    let [x, y, z] = normal;
    if (z < 0) { x = -x; y = -y; z = -z; }
    const d = .5 + .5 * Math.max(-1, Math.min(1, -.66 * x + .58 * y + .45 * z));
    const bounce = .5 + .5 * Math.cos(u - .6);
    return [132 + 123 * d, 30 + d * (120 + 43 * bounce), 18 + 62 * d * d + 14 * t];
  }

  function geometry(theme) {
    const triangles = [];
    let xMin = Infinity, yMin = Infinity, xMax = -Infinity, yMax = -Infinity;
    const folded = theme === "orange";
    const ringCount = theme === "teal" ? 5 : 1;
    const uCount = folded ? 68 : (ringCount > 1 ? 112 : 168);
    const vCount = folded ? 8 : (ringCount > 1 ? 42 : 100);
    for (let ring = 0; ring < ringCount; ring++) {
      const shape = folded ? paper : (ringCount > 1 ? (u, v) => orbit(u, v, ring) : ribbon);
      const vertices = [];
      for (let i = 0; i <= uCount; i++) {
        const u = i / uCount * TAU;
        for (let j = 0; j <= vCount; j++) {
          const v = j / vCount * TAU;
          const p = shape(u, v);
          const normal = norm(cross(sub(shape(u + .001, v), shape(u - .001, v)), sub(shape(u, v + .001), shape(u, v - .001))));
          const perspective = 4.6 / (4.6 - p[2]);
          const xx = p[0] * perspective, yy = -p[1] * perspective;
          xMin = Math.min(xMin, xx); xMax = Math.max(xMax, xx);
          yMin = Math.min(yMin, yy); yMax = Math.max(yMax, yy);
          vertices.push({x: xx, y: yy, z: p[2], p, color: folded ? null : metal(normal, theme === "teal", u, v)});
        }
      }
      for (let i = 0; i < uCount; i++) {
        for (let j = 0; j < vCount; j++) {
          const n = i * (vCount + 1) + j;
          const a = vertices[n], b = vertices[n + vCount + 1], c = vertices[n + vCount + 2], d = vertices[n + 1];
          const face = folded ? paperTone(norm(cross(sub(b.p, a.p), sub(d.p, a.p))), i / uCount * TAU, j / vCount) : null;
          triangles.push([a, b, c, face], [a, c, d, face]);
        }
      }
    }
    return {triangles, xMin, xMax, yMin, yMax};
  }

  function render(theme) {
    const canvas = document.createElement("canvas");
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext("2d");
    const pixels = ctx.createImageData(width, height);
    const data = pixels.data;
    const depth = new Float32Array(width * height).fill(-Infinity);
    const {triangles, xMin, xMax, yMin, yMax} = geometry(theme);
    const scale = Math.min((width - 10) / (xMax - xMin), (height - 10) / (yMax - yMin));
    const tx = (width - (xMax + xMin) * scale) / 2;
    const ty = (height - (yMax + yMin) * scale) / 2;
    for (const [a, b, c, face] of triangles) {
      const ax = a.x * scale + tx, ay = a.y * scale + ty;
      const bx = b.x * scale + tx, by = b.y * scale + ty;
      const cx = c.x * scale + tx, cy = c.y * scale + ty;
      const divisor = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(divisor) < .00001) continue;
      const left = Math.max(0, Math.floor(Math.min(ax, bx, cx))), right = Math.min(width - 1, Math.ceil(Math.max(ax, bx, cx)));
      const top = Math.max(0, Math.floor(Math.min(ay, by, cy))), bottom = Math.min(height - 1, Math.ceil(Math.max(ay, by, cy)));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const u = ((by - cy) * (x + .5 - cx) + (cx - bx) * (y + .5 - cy)) / divisor;
          const v = ((cy - ay) * (x + .5 - cx) + (ax - cx) * (y + .5 - cy)) / divisor;
          const w = 1 - u - v;
          if (Math.min(u, v, w) < 0) continue;
          const z = u * a.z + v * b.z + w * c.z, index = y * width + x;
          if (z <= depth[index]) continue;
          depth[index] = z;
          const idx = index * 4;
          for (let channel = 0; channel < 3; channel++) {
            data[idx + channel] = face ? face[channel] : u * a.color[channel] + v * b.color[channel] + w * c.color[channel];
          }
          data[idx + 3] = 255;
        }
      }
    }
    ctx.putImageData(pixels, 0, 0);
    return canvas.toDataURL("image/png");
  }

  window.posterArt = function posterArt(theme) {
    if (!["violet", "orange", "teal"].includes(theme)) theme = "violet";
    if (!cache.has(theme)) cache.set(theme, render(theme));
    return '<span aria-hidden="true" class="poster-art poster-art--' + theme + '"><img class="poster-art__object" draggable="false" alt="" src="' + cache.get(theme) + '"></span>';
  };
})();
