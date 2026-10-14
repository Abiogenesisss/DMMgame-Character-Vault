import importlib.util
"""Export cataloged DOTABYSS resources without executing game code or media."""
import hashlib
import io
import json
import math
import pathlib
import re
import sys
import zlib

import UnityPy
from PIL import Image
from UnityPy.classes.PPtr import PPtr
from animation import motion3, native_motion
from animator import animator_program
from ui_export import export_ui, ui_sprite_image
from materials import save_render_profile
from effects import export_particles

helper_spec = importlib.util.spec_from_file_location('local_unity_assets', pathlib.Path(__file__).with_name('unity_assets.py'))
helpers = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helpers)


def ref(owner, value):
    return PPtr(m_FileID=value['m_FileID'], m_PathID=value['m_PathID'], assetsfile=owner.assets_file).deref()


def components(game):
    return [ref(game, value['component']) for value in game.parse_as_dict()['m_Component']]


def transform(game):
    return next(item for item in components(game) if item.type.name in ['Transform', 'RectTransform'])


def graph(game):
    result = []
    def walk(item, path, depth=0):
        if depth > 64 or len(result) > 10000:
            raise ValueError('Prefab hierarchy exceeds limit')
        result.append((item, path))
        trans = transform(item)
        for pointer in trans.parse_as_dict()['m_Children']:
            child_transform = ref(trans, pointer)
            child = ref(child_transform, child_transform.parse_as_dict()['m_GameObject'])
            name = child.parse_as_dict()['m_Name']
            walk(child, path + '/' + name if path else name, depth + 1)
    walk(game, '')
    return result


def portrait(game, root, include_scene=False):
    nodes = graph(game)
    active, rectangles, images, layers, anchor_paths = {}, {}, [], [], {}
    for item, name in nodes:
        data = item.parse_as_dict()
        parent = name.rsplit('/', 1)[0] if '/' in name else ''
        active[name] = bool(data['m_IsActive']) and (not name or active.get(parent, True))
        trans = transform(item).parse_as_dict()
        parent_rect = rectangles.get(parent, {'x': 0, 'y': 0, 'width': 0, 'height': 0, 'sx': 1, 'sy': 1, 'pivot': {'x': .5, 'y': .5}})
        position = trans.get('m_AnchoredPosition', trans.get('m_LocalPosition', {'x': 0, 'y': 0}))
        size = trans.get('m_SizeDelta', {'x': 0, 'y': 0})
        amin, amax = trans.get('m_AnchorMin', {}), trans.get('m_AnchorMax', {})
        pivot = trans.get('m_Pivot', {'x': .5, 'y': .5})
        scale = trans.get('m_LocalScale', {'x': 1, 'y': 1})
        width = size['x'] + (amax.get('x', 0) - amin.get('x', 0)) * parent_rect['width']
        height = size['y'] + (amax.get('y', 0) - amin.get('y', 0)) * parent_rect['height']
        # RectTransform positions refer to its pivot within the parent anchors.
        # Children inherit the parent's scale, including the face's offset.
        local_x = position['x'] + (amin.get('x', 0) + (amax.get('x', 0) - amin.get('x', 0)) * pivot['x'] - parent_rect['pivot']['x']) * parent_rect['width']
        local_y = position['y'] + (amin.get('y', 0) + (amax.get('y', 0) - amin.get('y', 0)) * pivot['y'] - parent_rect['pivot']['y']) * parent_rect['height']
        rectangles[name] = {'x': parent_rect['x'] + local_x * parent_rect['sx'], 'y': parent_rect['y'] + local_y * parent_rect['sy'], 'width': width, 'height': height,
                            'sx': parent_rect['sx'] * scale['x'], 'sy': parent_rect['sy'] * scale['y'], 'pivot': pivot}
        for component in components(item):
            if component.type.name != 'MonoBehaviour':
                continue
            props = component.parse_as_dict()
            if include_scene and props.get('_emotionTrans', {}).get('m_PathID'):
                anchor_transform = ref(component, props['_emotionTrans'])
                anchor_game = ref(anchor_transform, anchor_transform.parse_as_dict()['m_GameObject'])
                anchor_paths['emotion'] = next(relative for node, relative in nodes if node.path_id == anchor_game.path_id and node.assets_file is anchor_game.assets_file)
            if (not active[name] and not include_scene) or not props.get('m_Enabled', 1) or not props.get('m_Sprite', {}).get('m_PathID'):
                continue
            sprite = ref(component, props['m_Sprite']).parse_as_object()
            # UnityPy's Sprite.image only returns the trimmed atlas rectangle.
            # Restore its transparent padding before fitting the Image rect, or
            # the eyes are stretched to fill the entire expression canvas.
            image = ui_sprite_image(sprite).convert('RGBA')
            rect = rectangles[name]
            width, height = rect['width'] or image.width, rect['height'] or image.height
            if props.get('m_PreserveAspect'):
                fit = min(width / image.width, height / image.height)
                width, height = image.width * fit, image.height * fit
            x1, x2 = rect['x'] - width * pivot['x'] * rect['sx'], rect['x'] + width * (1 - pivot['x']) * rect['sx']
            y1, y2 = rect['y'] - height * pivot['y'] * rect['sy'], rect['y'] + height * (1 - pivot['y']) * rect['sy']
            width, height = abs(width * rect['sx']), abs(height * rect['sy'])
            if width == 0 or height == 0:
                continue
            if width <= 0 or height <= 0 or width * height > 32 * 1024 * 1024:
                raise ValueError('Portrait rectangle exceeds limit')
            image = image.resize((max(1, round(width)), max(1, round(height))), Image.Resampling.LANCZOS)
            if rect['sx'] < 0:
                image = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            if rect['sy'] < 0:
                image = image.transpose(Image.Transpose.FLIP_TOP_BOTTOM)
            x, y = min(x1, x2), -max(y1, y2)
            if include_scene:
                layers.append({'name': name, 'active': active[name], 'file': helpers.image_file(root, image)['file'], 'x': x, 'y': y, 'width': image.width, 'height': image.height})
            if active[name]:
                images.append((image, x, y))
    if not images:
        raise ValueError('Prefab has no active portrait sprite')
    left = math.floor(min(value[1] for value in images))
    top = math.floor(min(value[2] for value in images))
    width = math.ceil(max(x + image.width for image, x, y in images)) - left
    height = math.ceil(max(y + image.height for image, x, y in images)) - top
    if width * height > 32 * 1024 * 1024:
        raise ValueError('Portrait exceeds size limit')
    canvas = Image.new('RGBA', (width, height))
    for image, x, y in images:
        canvas.alpha_composite(image, (round(x - left), round(y - top)))
    result = {'image': {**helpers.image_file(root, canvas), 'exportVersion': 2, 'origin': [left, top]}}
    if include_scene:
        anchors = {key: {'x': rectangles[name]['x'], 'y': -rectangles[name]['y'], 'scale': [rectangles[name]['sx'], rectangles[name]['sy']]} for key, name in anchor_paths.items()}
        scene = {'version': 2, 'origin': [left, top], 'width': width, 'height': height, 'layers': layers, 'anchors': anchors}
        raw = json.dumps(scene, allow_nan=False).encode()
        result['scene'] = {'version': 2, 'file': helpers.save_bytes(root, 'portraits/' + hashlib.sha256(raw).hexdigest() + '.json', raw), 'files': list(dict.fromkeys(layer['file'] for layer in layers))}
    return result


def safe_name(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', value):
        raise ValueError('Unsafe Live2D resource name')
    return value


def live2d(game, request, root):
    nodes = graph(game)
    targets, textures, moc, defaults = {}, {}, None, {}
    for item, relative in nodes:
        for component in components(item):
            if component.type.name != 'MonoBehaviour':
                continue
            data = component.parse_as_dict()
            if data.get('_moc', {}).get('m_PathID'):
                source = ref(component, data['_moc']).parse_as_dict()
                moc = bytes(source['_bytes'])
            if data.get('_mainTexture', {}).get('m_PathID'):
                texture = ref(component, data['_mainTexture'])
                textures[texture.peek_name()] = texture
            if 'Value' in data or 'Opacity' in data:
                script = ref(component, data['m_Script']).parse_as_dict()
                kind = script.get('m_ClassName')
                if kind in ['CubismParameter', 'CubismPart', 'CubismRenderController']:
                    target = 'Parameter' if kind == 'CubismParameter' else 'PartOpacity' if kind == 'CubismPart' else 'ModelOpacity'
                    identifier = item.peek_name() if target != 'ModelOpacity' else 'ModelOpacity'
                    defaults[identifier] = {'target': target, 'value': data.get('Value', data.get('Opacity', 0))}
                    parts = relative.split('/')
                    for start in range(len(parts)):
                        targets[zlib.crc32('/'.join(parts[start:]).encode())] = (target, identifier)
    if not moc or not moc.startswith(b'MOC3') or len(moc) > 16 * 1024 * 1024 or not textures:
        raise ValueError('Incomplete Live2D model')
    output_folder = 'live2d/' + request['fingerprint']
    previous = request.get('model') if request['kind'] == 'motion-data' else None
    files = list(previous['files']) if previous else []
    def save(name, value):
        name = safe_name(name)
        file = helpers.save_bytes(root, output_folder + '/' + name, value)
        files.append(file)
        return name
    if previous:
        texture_names = json.loads((root / output_folder / 'model.model3.json').read_text(encoding='utf8'))['FileReferences']['Textures']
    else:
        save('model.moc3', moc)
        texture_names = []
        for index, (name, texture) in enumerate(sorted(textures.items())):
            if not re.fullmatch(r'texture_\d+', name) or int(name.rsplit('_', 1)[1]) != index:
                raise ValueError('Live2D texture index is ambiguous')
            image = texture.parse_as_object().image
            if image.width * image.height > 32 * 1024 * 1024:
                raise ValueError('Live2D texture exceeds limit')
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            texture_names.append(save(name + '.png', stream.getvalue()))
    animations, motions, native_animations = [], {}, {}
    owned_clips, controller = animator_program(nodes, components, ref)
    # Facial clips share the rig but must not become standalone gallery scenes.
    def add_clip(obj):
        data = obj.parse_as_dict()
        name = data['m_Name']
        if name in native_animations:
            return
        try:
            native_animations[name] = native_motion(data, targets, allow_partial=True)
        except ValueError:
            return
        if not re.fullmatch(r'scene\d+(?:_loop)?', name, re.IGNORECASE):
            return
        parsed = motion3(data, targets, allow_partial=True)
        file = save(safe_name(name) + '.motion3.json', json.dumps(parsed, allow_nan=False).encode())
        motions[name] = [{'File': file, 'FadeInTime': 0.0, 'FadeOutTime': 0.0}]
        animations.append(name)

    # Only clips bound to this prefab's Cubism hierarchy are eligible, including
    # clips in the Animator's dependency bundle and zero-duration expressions.
    for obj in owned_clips.values():
        add_clip(obj)
    if not animations:
        raise ValueError('No animations bound to this Live2D model')
    model = {'Version': 3, 'FileReferences': {'Moc': 'model.moc3', 'Textures': texture_names, 'Motions': motions}}
    save('model.model3.json', json.dumps(model).encode())
    save('performance.json', json.dumps({'version': 1, 'defaults': defaults, 'animations': native_animations, 'controller': controller}, allow_nan=False).encode())
    model = {**(previous or {}), 'file': output_folder + '/model.model3.json', 'performance': output_folder + '/performance.json', 'files': list(dict.fromkeys(files)), 'engine': 'live2d', 'animations': sorted(animations), 'fit': 'bounds', 'motionVersion': 2}
    if previous and previous.get('exportVersion') == 6 and previous.get('renderVersion') == 2 and previous.get('materials') and (root / previous['materials']).is_file():
        return {'model': model}
    return {'model': save_render_profile(nodes, request, root, helpers, components, ref, model)}


def export(request, root, env):
    if request['kind'] == 'story-ui':
        return export_ui(env, root, helpers, ref, components, transform)
    selected = next(value.deref() for key, value in env.container.items() if key == request['internalId'])
    kind = request['kind']
    if kind == 'materials':
        return {'model': save_render_profile(graph(selected), request, root, helpers, components, ref, request['model'])}
    if kind in ['motions', 'motion-data']:
        return live2d(selected, {**request, '_env': env}, root)
    if selected.type.name == 'GameObject':
        if kind == 'story-effects':
            return export_particles(selected, root, helpers, graph, components, transform, ref)
        return portrait(selected, root, include_scene=kind == 'story-actors')
    if selected.type.name in ['Sprite', 'Texture2D']:
        return {'image': helpers.image_file(root, selected.parse_as_object().image)}
    if selected.type.name == 'TextAsset':
        data = selected.parse_as_dict()
        raw = data['m_Script']
        if isinstance(raw, str): raw = raw.encode('utf8', errors='surrogateescape')
        if len(raw) > 8 * 1024 * 1024:
            raise ValueError('Scenario script exceeds limit')
        digest = hashlib.sha256(raw).hexdigest()
        return {'script': {'file': helpers.save_bytes(root, 'scripts/' + digest + '.txt', raw), 'bytes': len(raw)}}
    if kind in ['voices', 'story-voices', 'music', 'sound']:
        data = selected.parse_as_dict()
        entry = next(value for value in data['references']['RefIds'] if value['rid'] == data['implementation']['rid'])
        if entry['type']['class'] != 'CriSerializedBytesAssetImpl':
            raise ValueError('External CRI bytes are not available in the bundle')
        raw = bytes(entry['data']['data'])
        if not raw.startswith(b'@UTF') or len(raw) > 80 * 1024 * 1024:
            raise ValueError('Invalid CRI bytes')
        digest = hashlib.sha256(raw).hexdigest()
        bank = {'file': helpers.save_bytes(root, 'audio-banks/' + digest + '.acb', raw), 'bytes': len(raw)}
        if request.get('banks'):
            if len(request['banks']) != 1:
                raise ValueError('Multiple external CRI banks are not supported')
            awb = pathlib.Path(request['banks'][0]).read_bytes()
            if not awb.startswith(b'AFS2'):
                raise ValueError('External CRI bank is invalid')
            bank['externalFile'] = helpers.save_bytes(root, 'audio-banks/' + hashlib.sha256(awb).hexdigest() + '.awb', awb)
        return {'bank': bank}
    raise ValueError('Unsupported DOTABYSS resource')


def main():
    request = json.load(sys.stdin)
    root = pathlib.Path(request['output']).resolve()
    root.mkdir(parents=True, exist_ok=True)
    result = {'resources': [], 'issues': []}
    groups = {}
    for item in request['assets']:
        groups.setdefault(tuple(item['inputs']), []).append(item)
    for inputs, items in groups.items():
        try:
            env = UnityPy.load(*inputs)
            for item in items:
                try:
                    value = export(item, root, env)
                    result['resources'].append({'address': item['address'], 'fingerprint': item['fingerprint'], **value})
                except Exception as error:
                    result['issues'].append({'address': item['address'], 'error': str(error)[:240]})
        except Exception as error:
            result['issues'].extend({'address': item['address'], 'error': str(error)[:240]} for item in items)
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
