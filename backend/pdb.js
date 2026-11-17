const AA3 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  MSE: 'M', SEC: 'U', PYL: 'O',
};

const V = {
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  dot: (a, b) => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }),
  len: (a) => Math.hypot(a.x, a.y, a.z) || 1,
  norm: (a) => {
    const l = V.len(a);
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Signed dihedral angle in degrees. */
function dihedral(p0, p1, p2, p3) {
  if (!p0 || !p1 || !p2 || !p3) return null;
  const b0 = V.sub(p0, p1);
  const b1 = V.sub(p2, p1);
  const b2 = V.sub(p3, p2);
  const b1n = V.norm(b1);
  const v = V.sub(b0, { x: b1n.x * V.dot(b0, b1n), y: b1n.y * V.dot(b0, b1n), z: b1n.z * V.dot(b0, b1n) });
  const w = V.sub(b2, { x: b1n.x * V.dot(b2, b1n), y: b1n.y * V.dot(b2, b1n), z: b1n.z * V.dot(b2, b1n) });
  const x = V.dot(v, w);
  const y = V.dot(V.cross(b1n, v), w);
  return Math.atan2(y, x) * 180 / Math.PI;
}

function classify(phi, psi) {
  if (phi == null || psi == null) return 'loop';
  // Alpha-helix basin (includes 3-10 / pi-helix shoulders).
  if (phi > -115 && phi < -25 && psi > -80 && psi < 25) return 'helix';
  // Extended beta-strand basin.
  if (phi > -175 && phi < -45 && (psi > 75 || psi < -145)) return 'sheet';
  return 'loop';
}

/**
 * Parse a PDB into a compact CA trace with DSSP-lite secondary structure.
 * CA coordinates remain the rendering anchor, but the cartoon renderer uses
 * the `ss` label (helix / sheet / loop) to draw helices, arrows and loops.
 */
export function parseCaTrace(pdbText, { targetChains = [], cdrSequences = {}, designedSequence = '' } = {}) {
  const chains = new Map();
  const lines = String(pdbText || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    const alt = line.slice(16, 17);
    if (alt && alt !== ' ' && alt !== 'A') continue;
    const atomName = line.slice(12, 16).trim();
    if (!atomName) continue;
    const chainId = line.slice(21, 22) || '_';
    const resName = line.slice(17, 20).trim().toUpperCase();
    const resSeq = line.slice(22, 27).trim();
    const x = num(line.slice(30, 38));
    const y = num(line.slice(38, 46));
    const z = num(line.slice(46, 54));
    if (x == null || y == null || z == null) continue;
    if (!chains.has(chainId)) chains.set(chainId, new Map());
    const residues = chains.get(chainId);
    const key = resSeq;
    if (!residues.has(key)) residues.set(key, { key, resName, resSeq, atoms: {} });
    const element = (line.slice(76, 78).trim() || atomName[0] || 'C').toUpperCase();
    residues.get(key).atoms[atomName] = { x, y, z, element };
  }

  const targetSet = new Set((targetChains || []).map((c) => String(c).trim()).filter(Boolean));
  const result = [];
  for (const [id, residueMap] of chains) {
    const residues = [...residueMap.values()]
      .filter((r) => r.atoms.CA)
      .sort((a, b) => (Number(String(a.resSeq).replace(/[^\d-]/g, '')) || 0) - (Number(String(b.resSeq).replace(/[^\d-]/g, '')) || 0));
    if (!residues.length) continue;

    const ss = [];
    for (let i = 0; i < residues.length; i++) {
      const prev = residues[i - 1];
      const next = residues[i + 1];
      const phi = dihedral(prev?.atoms.C, residues[i].atoms.N, residues[i].atoms.CA, residues[i].atoms.C);
      const psi = dihedral(residues[i].atoms.N, residues[i].atoms.CA, residues[i].atoms.C, next?.atoms.N);
      ss.push(classify(phi, psi));
    }
    // Bridge short loop gaps between the same regular secondary structure.
    for (let i = 0; i < ss.length; i++) {
      if (ss[i] !== 'loop') continue;
      let j = i;
      while (j < ss.length && ss[j] === 'loop') j++;
      const prev = i > 0 ? ss[i - 1] : 'loop';
      const next = j < ss.length ? ss[j] : 'loop';
      if (prev === next && prev !== 'loop' && j - i <= 2) {
        for (let k = i; k < j; k++) ss[k] = prev;
      }
      i = j - 1;
    }
    const runs = [];
    for (let i = 0; i < ss.length; i++) {
      const start = i;
      while (i + 1 < ss.length && ss[i + 1] === ss[start]) i++;
      runs.push({ ss: ss[start], start, end: i });
    }
    for (const run of runs) {
      const len = run.end - run.start + 1;
      if ((run.ss === 'helix' && len < 4) || (run.ss === 'sheet' && len < 3)) {
        for (let i = run.start; i <= run.end; i++) ss[i] = 'loop';
      }
    }

    const atoms = residues.map((r, i) => ({
      key: r.key,
      resName: r.resName,
      resSeq: r.resSeq,
      aa: AA3[r.resName] || 'X',
      x: r.atoms.CA.x,
      y: r.atoms.CA.y,
      z: r.atoms.CA.z,
      ss: ss[i],
    }));
    const allAtomResidues = residues.map((r, i) => {
      const atoms = Object.entries(r.atoms)
        .filter(([, atom]) => atom.element !== 'H')
        .map(([name, atom]) => ({ name, element: atom.element, x: atom.x, y: atom.y, z: atom.z }));
      const bonds = [];
      for (let a = 0; a < atoms.length; a++) {
        for (let b = a + 1; b < atoms.length; b++) {
          const distance = Math.hypot(atoms[a].x - atoms[b].x, atoms[a].y - atoms[b].y, atoms[a].z - atoms[b].z);
          if (distance > 0.4 && distance < 1.9) bonds.push([atoms[a].name, atoms[b].name]);
        }
      }
      return {
        resSeq: r.resSeq,
        resName: r.resName,
        aa: AA3[r.resName] || 'X',
        ss: ss[i],
        atoms,
        bonds,
      };
    });
    const sequence = atoms.map((a) => a.aa).join('');
    const role = targetSet.size ? (targetSet.has(id) ? 'target' : 'binder') : 'target';
    const ssSummary = { helix: 0, sheet: 0, loop: 0 };
    for (const s of ss) ssSummary[s] += 1;
    result.push({ id, role, sequence, atoms, residues: allAtomResidues, ssSummary });
  }

  if (!targetSet.size && result.length > 1) {
    result.sort((a, b) => b.atoms.length - a.atoms.length);
    result[0].role = 'target';
    for (const chain of result.slice(1)) chain.role = 'binder';
  }

  const binder = result.find((c) => c.role === 'binder' && c.sequence === designedSequence)
    || result.find((c) => c.role === 'binder')
    || result.find((c) => c.sequence === designedSequence)
    || result[result.length - 1];

  for (const chain of result) {
    chain.cdrs = [];
    if (chain !== binder) continue;
    for (const [key, sequence] of Object.entries(cdrSequences || {})) {
      if (!sequence) continue;
      const start = chain.sequence.indexOf(sequence);
      if (start >= 0) chain.cdrs.push({ key, start, end: start + sequence.length - 1 });
    }
  }

  const all = result.flatMap((c) => c.atoms);
  const center = all.length
    ? {
      x: all.reduce((s, a) => s + a.x, 0) / all.length,
      y: all.reduce((s, a) => s + a.y, 0) / all.length,
      z: all.reduce((s, a) => s + a.z, 0) / all.length,
    }
    : { x: 0, y: 0, z: 0 };
  const maxRadius = all.reduce((m, a) => Math.max(m, Math.hypot(a.x - center.x, a.y - center.y, a.z - center.z)), 1);
  const ssSummary = { helix: 0, sheet: 0, loop: 0 };
  for (const chain of result) {
    for (const key of Object.keys(ssSummary)) ssSummary[key] += chain.ssSummary[key] || 0;
  }

  return {
    chains: result,
    center,
    maxRadius,
    totalResidues: all.length,
    targetChains: result.filter((c) => c.role === 'target').map((c) => c.id),
    binderChains: result.filter((c) => c.role === 'binder').map((c) => c.id),
    binderChain: binder?.id || null,
    ssSummary,
  };
}
