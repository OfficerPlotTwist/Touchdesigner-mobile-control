export const REGISTRY_COLUMNS = ['index', 'comp_path', 'title', 'author', 'created_ts'];

export const effectName = (requestId) => `fx_${requestId}`;
export const effectPath = (contract, requestId) => `${contract.effectsPath}/${effectName(requestId)}`;

export function registryRow({ index, compPath, title, author, createdTs }) {
  return [String(index), String(compPath), String(title), String(author), String(createdTs)];
}

// Returns the Python the worker sends through TdBridge.execScript() to make the
// project contract exist. Idempotent: every create is guarded, so re-running on
// an already-scaffolded project is a no-op. `effectsPath` is a container path
// like /project1/effects; we split it into parent + child for op().create.
export function scaffoldScript(contract) {
  const { effectsPath, switchPath, registryPath, safeIndex } = contract;
  const lastSlash = effectsPath.lastIndexOf('/');
  const parentPath = effectsPath.slice(0, lastSlash) || '/';
  const effectsName = effectsPath.slice(lastSlash + 1);
  const sw = switchPath.slice(switchPath.lastIndexOf('/') + 1);
  const reg = registryPath.slice(registryPath.lastIndexOf('/') + 1);
  const cols = REGISTRY_COLUMNS.join('\\t');
  return [
    `# effects-on-demand contract scaffold (idempotent)`,
    `# ensure effects container at ${effectsPath}`,
    `parent_comp = op('${parentPath}')`,
    `effects = parent_comp.op('${effectsName}') or parent_comp.create(baseCOMP, '${effectsName}')`,
    ``,
    `# index-0 reserved safe/idle effect (boot default + panic target)`,
    `safe = effects.op('fx_safe') or effects.create(baseCOMP, 'fx_safe')`,
    ``,
    `# fx_switch: selects which effect composites to the projection`,
    `sw = parent_comp.op('${sw}') or parent_comp.create(switchTOP, '${sw}')`,
    `sw.par.index = ${safeIndex}`,
    ``,
    `# fx_registry: source of truth | ${REGISTRY_COLUMNS.join(' | ')}`,
    `reg = parent_comp.op('${reg}') or parent_comp.create(tableDAT, '${reg}')`,
    `if reg.numRows == 0:`,
    `    reg.appendRow('${cols}'.split('\\t'))`,
    `    reg.appendRow(['${safeIndex}', effects.op('fx_safe').path, 'safe', '', '0'])`,
    ``,
    `# attribution overlay: a Text TOP that reads author of the current switch index`,
    `attrib = parent_comp.op('fx_attrib') or parent_comp.create(textTOP, 'fx_attrib')`,
    `attrib.par.text = "op('${reg}')[ op('${sw}').par.index.eval()+1, 'author'] or ''"`,
    ``,
    `print('eod-contract: ok')`,
  ].join('\n');
}
