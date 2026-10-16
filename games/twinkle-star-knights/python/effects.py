"""Export bounded, declarative effect data and textures; no client code executes."""
import json
import math


def curve(value, fallback=0):
    value = value or {}
    def keys(name):
        return [[v if math.isfinite(v) else None for v in [p['time'], p['value'], p.get('inSlope', 0), p.get('outSlope', 0)]] for p in value.get(name, {}).get('m_Curve', [])]
    return {'mode': value.get('minMaxState', 0), 'max': value.get('scalar', fallback),
            'min': value.get('minScalar', fallback), 'a': keys('minCurve'), 'b': keys('maxCurve')}


def color(value):
    value = value or {}
    def gradient(name):
        g = value.get(name, {})
        return {'rgb': [[g.get('ctime' + str(i), 0) / 65535, g['key' + str(i)]] for i in range(g.get('m_NumColorKeys', 0))],
                'alpha': [[g.get('atime' + str(i), 0) / 65535, g['key' + str(i)].get('a', 1)] for i in range(g.get('m_NumAlphaKeys', 0))]}
    white = {'r': 1, 'g': 1, 'b': 1, 'a': 1}
    return {'mode': value.get('minMaxState', 0), 'min': value.get('minColor', white), 'max': value.get('maxColor', white),
            'a': gradient('minGradient'), 'b': gradient('maxGradient')}


def export_effect(env, selected, request, root, save, image):
    objects = list(env.objects)
    def ref(owner, p):
        if not p.get('m_PathID'):
            return None
        if not p.get('m_FileID'):
            return owner.assets_file.objects[p['m_PathID']]
        found = [o for o in objects if o.path_id == p['m_PathID']]
        if len(found) != 1:
            raise ValueError('Missing or ambiguous effect reference')
        return found[0]
    root_id = selected.path_id
    transforms = {o.parse_as_dict()['m_GameObject']['m_PathID']: o for o in objects if o.type.name in ('Transform', 'RectTransform')}
    def pose(go, visited=None):
        visited = (visited or set()) | {go}
        transform = transforms[go]
        d = transform.parse_as_dict()
        p, s, q = d['m_LocalPosition'], d['m_LocalScale'], d['m_LocalRotation']
        angle = math.atan2(2 * (q['w'] * q['z'] + q['x'] * q['y']), 1 - 2 * (q['y'] ** 2 + q['z'] ** 2))
        result = [p['x'], p['y'], s['x'], s['y'], angle]
        parent = ref(transform, d['m_Father'])
        if parent and go != root_id:
            pg = parent.parse_as_dict()['m_GameObject']['m_PathID']
            if pg in visited:
                raise ValueError('Effect transform cycle')
            x, y, sx, sy, a = pose(pg, visited)
            result = [x + p['x'] * sx * math.cos(a) - p['y'] * sy * math.sin(a), y + p['x'] * sx * math.sin(a) + p['y'] * sy * math.cos(a), sx * s['x'], sy * s['y'], a + angle]
        return result
    files, textures = [], {}
    def export_texture(obj):
        key = (obj.assets_file.name, obj.path_id)
        if key not in textures:
            textures[key] = image(root, obj)
            files.append(textures[key]['file'])
        return textures[key]
    if '/TitleBand/' in request['internalId']:
        available = {o.peek_name(): o for o in objects if o.type.name == 'Sprite'}
        names = ['bg', 'frame_half', 'frame_half_lr_p', 'pattern', 'pattern_p']
        clip = next(o.parse_as_dict() for o in objects if o.type.name == 'AnimationClip' and o.peek_name() == 'title_band_new')
        data = {'kind': 'title', 'duration': clip['m_MuscleClip']['m_StopTime'], 'sprites': {n: export_texture(available[n]) for n in names}}
    else:
        emitters, unsupported = [], set()
        for obj in objects:
            if obj.type.name != 'ParticleSystem':
                continue
            d = obj.parse_as_dict()
            go = d['m_GameObject']['m_PathID']
            renderer = next((o for o in objects if o.type.name == 'ParticleSystemRenderer' and o.parse_as_dict()['m_GameObject']['m_PathID'] == go), None)
            if renderer is None:
                continue
            rd = renderer.parse_as_dict()
            if not rd['m_Enabled'] or not rd['m_Materials']:
                continue
            material = ref(renderer, rd['m_Materials'][0])
            md = material.parse_as_dict()
            props = md.get('m_SavedProperties', {})
            tex = dict(props.get('m_TexEnvs', [])).get('_MainTex')
            if not tex or not tex['m_Texture']['m_PathID']:
                unsupported.add('material:' + md['m_Name'])
                continue
            tex_obj = ref(material, tex['m_Texture'])
            initial, emission, shape = d['InitialModule'], d['EmissionModule'], d['ShapeModule']
            if rd['m_RenderMode'] == 4:
                unsupported.add('mesh-particles')
            for name in ['NoiseModule', 'TrailModule', 'CollisionModule', 'SubModule']:
                if d.get(name, {}).get('enabled'):
                    unsupported.add(name)
            floats = dict(props.get('m_Floats', []))
            tint = dict(props.get('m_Colors', [])).get('_TintColor', {'r': 1, 'g': 1, 'b': 1, 'a': 1})
            def module(name, key):
                item = d.get(name, {})
                return curve(item.get(key)) if item.get('enabled') else None
            uv = d['UVModule']
            emitters.append({'pose': pose(go), 'duration': d['lengthInSec'], 'loop': d['looping'], 'delay': curve(d['startDelay']),
                'lifetime': curve(initial['startLifetime']), 'speed': curve(initial['startSpeed']), 'size': curve(initial['startSize']),
                'sizeY': curve(initial['startSizeY']) if initial['size3D'] else None, 'rotation': curve(initial['startRotation']), 'color': color(initial['startColor']),
                'gravity': curve(initial['gravityModifier']), 'max': min(300, initial['maxNumParticles']), 'texture': export_texture(tex_obj),
                'additive': floats.get('_DstBlend') == 1 or 'add' in md['m_Name'].lower(), 'tint': tint,
                'stretch': rd['m_LengthScale'] if rd['m_RenderMode'] == 1 else 1, 'shape': {k: shape[k] for k in ['enabled', 'type', 'm_Position', 'm_Rotation', 'm_Scale', 'radius', 'angle']},
                'rate': curve(emission['rateOverTime']) if emission['enabled'] else curve(None),
                'bursts': [{'time': b['time'], 'count': curve(b['countCurve']), 'cycles': b['cycleCount'], 'interval': b['repeatInterval'], 'probability': b['probability']} for b in emission['m_Bursts']] if emission['enabled'] else [],
                'sizeOverLife': module('SizeModule', 'curve'), 'rotationOverLife': module('RotationModule', 'curve'),
                'colorOverLife': color(d['ColorModule']['gradient']) if d['ColorModule']['enabled'] else None,
                'velocity': [module('VelocityModule', k) for k in ['x', 'y']], 'force': [module('ForceModule', k) for k in ['x', 'y']],
                'sheet': {'cols': uv['tilesX'], 'rows': uv['tilesY'], 'frame': curve(uv['frameOverTime']), 'start': curve(uv['startFrame']), 'cycles': uv['cycles']} if uv['enabled'] else None})
        if not emitters:
            raise ValueError('Effect has no supported texture emitters')
        data = {'kind': 'particles', 'emitters': emitters, 'unsupported': sorted(unsupported)}
    file = 'effects/' + request['fingerprint'] + '.json'
    save(root, file, json.dumps(data, ensure_ascii=False, allow_nan=False).encode('utf8'))
    return {'effect': {'file': file, 'files': sorted(set(files + [file])), 'effectKind': data['kind'], 'unsupported': data.get('unsupported', [])}}
