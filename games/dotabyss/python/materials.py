"""Preserve the Unity materials that are not part of a Cubism MOC file."""
import json
import math
import re

SHADERS = {'Abyss/Live2DUnlit': 'unlit', 'Abyss/Live2DMosaicV2': 'mosaic'}


def rgba(value):
    return [value[key] for key in ['r', 'g', 'b', 'a']]


def post_process_profile(nodes, components, ref):
    # PlayerSettings.m_ActiveColorSpace == 1. Novel's R18Camera enables post
    # processing and includes the model Volume's layer 14 in its volume mask.
    bloom = {'threshold': 1.0, 'intensity': 0.0, 'scatter': .7, 'clamp': 65472.0,
             'tint': [1.0, 1.0, 1.0], 'downscale': 0, 'maxIterations': 6, 'skipIterations': 1}
    chroma, volumes, active = 0.0, [], {}
    for obj, relative in nodes:
        parent = relative.rsplit('/', 1)[0] if '/' in relative else ''
        active[relative] = bool(obj.parse_as_dict()['m_IsActive']) and (not relative or active.get(parent, True))
        if not active[relative]:
            continue
        for component in components(obj):
            if component.type.name != 'MonoBehaviour':
                continue
            data = component.parse_as_dict()
            if data.get('sharedProfile', {}).get('m_PathID') and data.get('m_Enabled') and data.get('m_IsGlobal') and data.get('weight', 0) > 0:
                volumes.append((data.get('priority', 0), min(1, data['weight']), ref(component, data['sharedProfile'])))
    for _, weight, profile in sorted(volumes, key=lambda item: item[0]):
        for pointer in profile.parse_as_dict()['components']:
            component = ref(profile, pointer)
            data = component.parse_as_dict()
            kind = ref(component, data['m_Script']).parse_as_dict().get('m_ClassName')
            if not data.get('active', True):
                continue
            if kind == 'ChromaticAberration' and data.get('intensity', {}).get('m_OverrideState'):
                chroma += (data['intensity']['m_Value'] - chroma) * weight
            if kind != 'Bloom':
                continue
            for key, before in list(bloom.items()):
                parameter = data.get(key, {})
                if not parameter.get('m_OverrideState'):
                    continue
                after = parameter['m_Value']
                if key == 'tint':
                    bloom[key] = rgba(after)[:3] if weight == 1 else [a + (b - a) * weight for a, b in zip(before, rgba(after)[:3])]
                elif key in ['downscale', 'maxIterations', 'skipIterations']:
                    bloom[key] = int(after)
                else:
                    bloom[key] = after if weight == 1 else before + (after - before) * weight
    if not all(math.isfinite(v) for v in [chroma, *[v for k, v in bloom.items() if k != 'tint'], *bloom['tint']]):
        raise ValueError('Invalid original post-processing parameters')
    return {'version': 1, 'colorSpace': 'linear', 'bloom': bloom, 'chromaticAberration': chroma}


def render_profile(nodes, components, ref):
    materials, drawables, known = {}, {}, {}
    for obj, relative in nodes:
        parts = components(obj)
        renderer = next((c.parse_as_dict() for c in parts if c.type.name == 'MonoBehaviour' and '_mainTexture' in c.parse_as_dict()), None)
        if renderer is None:
            continue
        mesh = next(c for c in parts if c.type.name == 'MeshRenderer')
        pointers = mesh.parse_as_dict()['m_Materials']
        if len(pointers) != 1 or not pointers[0]['m_PathID']:
            raise ValueError('Live2D drawable must have one original material')
        source = ref(mesh, pointers[0])
        identity = (id(source.assets_file), source.path_id)
        if identity not in known:
            data = source.parse_as_dict()
            shader = ref(source, data['m_Shader']).parse_as_dict()['m_ParsedForm']['m_Name']
            if shader not in SHADERS:
                raise ValueError('Unsupported DOTABYSS material shader: ' + shader)
            properties = data['m_SavedProperties']
            floats, colors, textures = dict(properties['m_Floats']), dict(properties['m_Colors']), dict(properties['m_TexEnvs'])
            emission = colors.get('_EmissionMapColor', {'r': 0, 'g': 0, 'b': 0, 'a': 1})
            if any(emission[k] for k in ['r', 'g', 'b']) and textures.get('_EmissionMapTex', {}).get('m_Texture', {}).get('m_PathID'):
                raise ValueError('Live2D emission texture requires export support')
            key = 'material' + str(len(materials))
            known[identity] = key
            materials[key] = {'name': data['m_Name'], 'shader': SHADERS[shader],
                              'queue': data['m_CustomRenderQueue'] if data['m_CustomRenderQueue'] >= 0 else 2450,
                              'blend': [floats.get(k, fallback) for k, fallback in [('_SrcColor', 1), ('_DstColor', 10), ('_SrcAlpha', 1), ('_DstAlpha', 10)]],
                              'cull': floats.get('_Cull', 0), 'emission': rgba(emission)[:3]}
            if SHADERS[shader] == 'mosaic':
                materials[key].update({'size': floats['_grabEffectValue'], 'offset': [floats['_ReUV_X'], floats['_ReUV_Y']]})
        texture = ref(obj, renderer['_mainTexture']).peek_name()
        if not re.fullmatch(r'texture_\d+', texture):
            raise ValueError('Unexpected Live2D texture binding')
        # MeshRenderer.enabled is a snapshot of the current Cubism opacity;
        # baking it would permanently hide meshes used by later animations.
        drawables[obj.peek_name()] = {'material': known[identity], 'texture': int(texture.rsplit('_', 1)[1]), 'color': rgba(renderer['_color'])}
        for channel, flag in [('multiply', '_isOverriddenDrawableMultiplyColors'), ('screen', '_isOverriddenDrawableScreenColors')]:
            if renderer.get(flag):
                drawables[obj.peek_name()][channel] = rgba(renderer['_' + channel + 'Color'])
    if not drawables:
        raise ValueError('Live2D material bindings are missing')
    return {'version': 1, 'game': 'dotabyss', 'materials': materials, 'drawables': drawables,
            'postProcessing': post_process_profile(nodes, components, ref)}


def save_render_profile(nodes, request, root, helpers, components, ref, model):
    folder = 'live2d/' + request['fingerprint']
    file = helpers.save_bytes(root, folder + '/materials.json', json.dumps(render_profile(nodes, components, ref), allow_nan=False).encode())
    return {**model, 'materials': file, 'files': list(dict.fromkeys([*model['files'], file])), 'exportVersion': 6, 'renderVersion': 2}
