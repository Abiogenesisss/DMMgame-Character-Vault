"""Retain particle textures and authored modules without loading or playing media."""
import hashlib
import json
import math


def export_particles(game, root, helpers, graph, components, transform, ref):
    layers, transforms, files = [], {}, []
    for item, name in graph(game):
        tr = transform(item).parse_as_dict()
        parent = transforms.get(name.rsplit('/', 1)[0] if '/' in name else '', {'position': [0, 0, 0], 'scale': [1, 1, 1]}) if name else {'position': [0, 0, 0], 'scale': [1, 1, 1]}
        position = [parent['position'][i] + tr['m_LocalPosition'][axis] * parent['scale'][i] for i, axis in enumerate('xyz')]
        scale = [parent['scale'][i] * tr['m_LocalScale'][axis] for i, axis in enumerate('xyz')]
        transforms[name] = {'position': position, 'scale': scale}
        parts = components(item)
        ps = next((p for p in parts if p.type.name == 'ParticleSystem'), None)
        renderer = next((p for p in parts if p.type.name == 'ParticleSystemRenderer'), None)
        if not ps or not renderer:
            continue
        data = ps.parse_as_dict()
        if not data['EmissionModule']['enabled']:
            continue
        rd = renderer.parse_as_dict()
        # UIParticle transfers this renderer's mesh into a CanvasRenderer and
        # deliberately disables the ordinary ParticleSystemRenderer.
        canvas_particle = any(p.type.name == 'CanvasRenderer' for p in parts)
        if (not rd.get('m_Enabled', 1) and not canvas_particle) or not rd.get('m_Materials'):
            continue
        material = ref(renderer, rd['m_Materials'][0])
        props = material.parse_as_dict()['m_SavedProperties']
        texture = next((v for k, v in props['m_TexEnvs'] if k in ['_MainTex', '_BaseMap'] and v['m_Texture']['m_PathID']), None)
        if not texture:
            continue
        image = ref(material, texture['m_Texture']).parse_as_object().image
        file = helpers.image_file(root, image)['file']
        files.append(file)
        layer = {k: data[k] for k in ['lengthInSec', 'looping', 'startDelay', 'InitialModule', 'EmissionModule', 'ShapeModule', 'VelocityModule', 'SizeModule', 'ColorModule', 'RotationModule'] if k in data}
        layer.update({'name': name, 'file': file, 'position': position, 'scale': scale, 'floats': dict(props['m_Floats']), 'colors': dict(props['m_Colors']), 'renderMode': rd.get('m_RenderMode', 0)})
        layers.append(layer)
    if not layers:
        raise ValueError('Effect has no supported particle textures')
    raw = json.dumps({'version': 1, 'layers': layers}, allow_nan=False).encode()
    return {'effect': {'version': 1, 'file': helpers.save_bytes(root, 'effects/' + hashlib.sha256(raw).hexdigest() + '.json', raw), 'files': list(dict.fromkeys(files))}}
