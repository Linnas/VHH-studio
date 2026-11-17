const AA3 = {
  ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
  LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  MSE: 'M', SEC: 'U', PYL: 'O',
};

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a PDB into a compact CA trace for the canvas renderer.
 * Keeps chain identity, residue order, sequences and CDR ranges.
 */
export function parseCaTrace(pdbText, { targetChains = [], cdrSequences = {}, designedSequence = '' } = {}) {
  const chains = new Map();
  const lines = String(pdbText || '').split(/\r?\n/);
  for (const line of lines) {
    if (!line.startsWith('ATOM') && !line.startsWith('HETATM')) continue;
    if (line.slice(12, 16).trim() !== 'CA') continue;
    const alt = line.slice(16, 17);
    if (alt && alt !== ' ' && alt !== 'A') continue;
    const chainId = line.slice(21, 22) || '_';
    const resName = line.slice(17, 20).trim().toUpperCase();
    const resSeq = line.slice(22, 27).trim();
    const x = num(line.slice(30, 38));
    const y = num(line.slice(38, 46));
    const z = num(line.slice(46, 54));
    if (x == null || y == null || z == null) continue;
    if (!chains.has(chainId)) chains.set(chainId, []);
    const atoms = chains.get(chainId);
    const key = `${resSeq}:${resName}`;
    if (atoms.some((a) => a.key === key)) continue;
    atoms.push({
      key,
      resName,
      resSeq,
      aa: AA3[resName] || 'X',
      x,
      y,
      z,
    });
  }

  const targetSet = new Set((targetChains || []).map((c) => String(c).trim()).filter(Boolean));
  const result = [];
  for (const [id, atoms] of chains) {
    atoms.sort((a, b) => {
      const an = Number(String(a.resSeq).replace(/[^\d-]/g, '')) || 0;
      const bn = Number(String(b.resSeq).replace(/[^\d-]/g, '')) || 0;
      return an - bn;
    });
    const sequence = atoms.map((a) => a.aa).join('');
    const role = targetSet.size ? (targetSet.has(id) ? 'target' : 'binder') : 'target';
    result.push({ id, role, sequence, atoms });
  }

  // Infer roles if the job did not declare target chains.
  if (!targetSet.size && result.length > 1) {
    result.sort((a, b) => b.atoms.length - a.atoms.length);
    result[0].role = 'target';
    for (const chain of result.slice(1)) chain.role = 'binder';
  }

  let binder = result.find((c) => c.role === 'binder' && c.sequence === designedSequence)
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

  return {
    chains: result,
    center,
    maxRadius,
    totalResidues: all.length,
    targetChains: result.filter((c) => c.role === 'target').map((c) => c.id),
    binderChains: result.filter((c) => c.role === 'binder').map((c) => c.id),
    binderChain: binder?.id || null,
  };
}
