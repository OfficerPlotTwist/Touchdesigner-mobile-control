# effects-on-demand contract scaffold (idempotent)
# ensure effects container at /project1/effects
parent_comp = op('/project1')
effects = parent_comp.op('effects') or parent_comp.create(baseCOMP, 'effects')

# index-0 reserved safe/idle effect (boot default + panic target)
safe = effects.op('fx_safe') or effects.create(baseCOMP, 'fx_safe')

# fx_switch: selects which effect composites to the projection
sw = parent_comp.op('fx_switch') or parent_comp.create(switchTOP, 'fx_switch')
sw.par.index = 0

# fx_registry: source of truth | index | comp_path | title | author | created_ts
reg = parent_comp.op('fx_registry') or parent_comp.create(tableDAT, 'fx_registry')
if reg.numRows == 0:
    reg.appendRow('index\tcomp_path\ttitle\tauthor\tcreated_ts'.split('\t'))
    reg.appendRow(['0', effects.op('fx_safe').path, 'safe', '', '0'])

# attribution overlay: a Text TOP that reads author of the current switch index
attrib = parent_comp.op('fx_attrib') or parent_comp.create(textTOP, 'fx_attrib')
attrib.par.text = "op('fx_registry')[ op('fx_switch').par.index.eval()+1, 'author'] or ''"

print('eod-contract: ok')
