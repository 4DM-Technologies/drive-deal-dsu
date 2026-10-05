import sys, yaml

d = yaml.safe_load(open('design/openapi.yaml', encoding='utf-8'))
refs = set()


def walk(n):
    if isinstance(n, dict):
        for k, v in n.items():
            if k == '$ref' and isinstance(v, str):
                refs.add(v)
            else:
                walk(v)
    elif isinstance(n, list):
        for v in n:
            walk(v)


walk(d)


def resolves(r):
    if not r.startswith('#/'):
        return False
    cur = d
    for part in r[2:].split('/'):
        part = part.replace('~1', '/').replace('~0', '~')
        if not isinstance(cur, dict) or part not in cur:
            return False
        cur = cur[part]
    return True


bad = [r for r in sorted(refs) if not resolves(r)]


def resolve(node):
    """Follow a single $ref so parameter objects can be inspected."""
    while isinstance(node, dict) and '$ref' in node:
        cur = d
        for part in node['$ref'][2:].split('/'):
            cur = cur[part.replace('~1', '/').replace('~0', '~')]
        node = cur
    return node
print('total refs:', len(refs))
print('broken:', len(bad))
for b in bad:
    print('  ', b)

# every operationId unique
ops = []
for p, item in d['paths'].items():
    for m, op in item.items():
        if m in ('get', 'post', 'put', 'patch', 'delete', 'head', 'options'):
            ops.append((op.get('operationId'), m.upper(), p))

print('operations:', len(ops))
seen = {}
for oid, m, p in ops:
    if oid in seen:
        print('  DUPLICATE operationId', oid, seen[oid], m, p)
    seen[oid] = (m, p)
missing = [o for o, m, p in ops if not o]
print('operations without operationId:', missing)

# every path parameter declared
for p, item in d['paths'].items():
    for m, op in item.items():
        if m not in ('get', 'post', 'put', 'patch', 'delete'):
            continue
        params = [resolve(q) for q in op.get('parameters', [])]
        declared = {q['name'] for q in params if 'name' in q}
        import re
        used = set(re.findall(r'\{(\w+)\}', p))
        for u in used - declared:
            print('  UNDECLARED path param', u, m.upper(), p)
        for dcl in declared - used:
            par = next(q for q in params if q.get('name') == dcl)
            if par.get('in') == 'path':
                print('  UNUSED path param', dcl, m.upper(), p)

# tags used are declared
declared_tags = {t['name'] for t in d.get('tags', [])}
used_tags = set()
for p, item in d['paths'].items():
    for m, op in item.items():
        if m in ('get', 'post', 'put', 'patch', 'delete'):
            used_tags.update(op.get('tags', []))
print('undeclared tags:', used_tags - declared_tags)
print('unused tags:', declared_tags - used_tags)
