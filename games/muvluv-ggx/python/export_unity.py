"""Export explicitly cataloged assets. Never execute client code or play media."""
import hashlib
import importlib.util
import io
import json
import os
import pathlib
import re
import sys
import warnings

import UnityPy
from UnityPy.exceptions import UnityVersionFallbackWarning
material_spec = importlib.util.spec_from_file_location('vault_muv_spine_materials', pathlib.Path(__file__).with_name('spine_materials.py'))
material_helpers = importlib.util.module_from_spec(material_spec)
material_spec.loader.exec_module(material_helpers)
atlas_material_modes = material_helpers.atlas_material_modes
atlas_spec = importlib.util.spec_from_file_location('vault_muv_atlas_metadata', pathlib.Path(__file__).with_name('atlas_metadata.py'))
atlas_helpers = importlib.util.module_from_spec(atlas_spec)
atlas_spec.loader.exec_module(atlas_helpers)
mark_pma = atlas_helpers.mark_pma

UnityPy.config.FALLBACK_UNITY_VERSION = os.environ.get('MUVLUV_UNITY_VERSION', '6000.0.0f1')
warnings.filterwarnings('ignore', category=UnityVersionFallbackWarning)

helper_spec = importlib.util.spec_from_file_location('local_unity_assets', pathlib.Path(__file__).with_name('unity_assets.py'))
helpers = importlib.util.module_from_spec(helper_spec)
helper_spec.loader.exec_module(helpers)


def text(value):
    return value.decode('utf8') if isinstance(value, bytes) else value


def matching_object(env, request):
    for key, obj in env.container.items():
        if key == request['internalId'] and obj.type.name == request['type'].split('.')[-1]:
            return obj.deref() if hasattr(obj, 'deref') else obj
    raise ValueError('Catalog asset is not present in its bundle')


def sprite_from_prefab(obj, objects):
    game_id = obj.path_id
    sprites = {item.path_id: item for item in objects if item.type.name == 'Sprite'}
    for component in objects:
        if component.type.name != 'MonoBehaviour':
            continue
        data = component.parse_as_dict()
        if helpers.ref_id(data.get('m_GameObject')) != game_id:
            continue
        sprite = sprites.get(helpers.ref_id(data.get('m_Sprite')))
        if sprite:
            return sprite
    raise ValueError('Prefab does not expose a complete sprite')


def restore_portrait_faces(skeleton, address):
    if not address.startswith('SCS/'):
        return
    # Unity's separate eye/mouth components select these attachments. The
    # expression animations only contain eyebrows, cheeks and nose, so playing
    # Normal alone leaves the eye slot empty. Bake their resting state into the
    # exported expressions; keep any authored attachment timelines intact.
    skin = next((item.get('attachments', {}) for item in skeleton.get('skins', [])
                 if item.get('name') == 'default'), {})
    slots = {item['name']: item for item in skeleton.get('slots', [])}
    faces = {'Normal': 'normal', 'Shy': 'shy', 'Delighted': 'delighted', 'Angry': 'angry',
             'Sad': 'sad', 'Surprised': 'surprise', 'Confused': 'confused', 'Scared': 'scared', 'Custom': 'custom'}
    for part, state in [('eye', 'opened'), ('mouth', 'closed')]:
        if part not in slots:
            continue
        attachments = skin.get(part, {})
        resting = part + '_normal_' + state
        if not slots[part].get('attachment') and resting in attachments:
            slots[part]['attachment'] = resting
        for animation_name, mood in faces.items():
            animation = skeleton.get('animations', {}).get(animation_name)
            attachment = part + '_' + mood + '_' + state
            if animation is not None and attachment in attachments:
                track = animation.setdefault('slots', {}).setdefault(part, {})
                track.setdefault('attachment', [{'name': attachment}])


def export_spine(env, request, root):
    objects = list(env.objects)
    material_modes = atlas_material_modes(objects)
    texts, skeletons, components = {}, {}, {}
    for obj in objects:
        if obj.type.name == 'TextAsset':
            data = obj.parse_as_dict()
            script = text(data['m_Script'])
            if len(script) > 16 * 1024 * 1024:
                raise ValueError('Spine data exceeds limit')
            texts[obj.path_id] = (data['m_Name'], script)
            try:
                parsed = json.loads(script)
                if isinstance(parsed, dict) and 'skeleton' in parsed and 'bones' in parsed:
                    skeletons[obj.path_id] = (data['m_Name'], parsed)
            except ValueError:
                pass
        elif obj.type.name == 'MonoBehaviour':
            components[obj.path_id] = obj.parse_as_dict()
    textures = {obj.peek_name(): obj for obj in objects if obj.type.name == 'Texture2D'}
    selected = matching_object(env, request)
    layers, files = [], []
    export_version = 3 if request['address'].startswith('SCS/') else 2
    folder = 'spine/muv-v' + str(export_version) + '-' + request['fingerprint']
    for component in components.values():
        if helpers.ref_id(component.get('m_GameObject')) != selected.path_id:
            continue
        source = components.get(helpers.ref_id(component.get('skeletonDataAsset')), {})
        skeleton_id = helpers.ref_id(source.get('skeletonJSON'))
        if skeleton_id not in skeletons:
            continue
        name, skeleton = skeletons[skeleton_id]
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
            raise ValueError('Unsafe Spine name')
        atlas_id = next((key for key, (n, _) in texts.items() if n == name + '.atlas'), None)
        if atlas_id is None or atlas_id not in material_modes:
            raise ValueError('Spine atlas or material is missing')
        mode = material_modes[atlas_id]
        atlas = mark_pma(texts[atlas_id][1], mode['pma'])
        pages = [line.strip() for line in atlas.splitlines() if line.strip().lower().endswith(('.png', '.jpg'))]
        for page in pages:
            if not re.fullmatch(r'[A-Za-z0-9_.-]+', page):
                raise ValueError('Unsafe texture path')
            texture = textures.get(pathlib.Path(page).stem)
            if texture is None:
                raise ValueError('Spine texture is missing')
            image = texture.parse_as_object().image
            if image.width * image.height > 32 * 1024 * 1024:
                raise ValueError('Texture dimensions exceed limit')
            stream = io.BytesIO()
            image.save(stream, format='PNG')
            helpers.save_bytes(root, folder + '/' + page, stream.getvalue())
            files.append(folder + '/' + page)
        skeleton['skeleton'].pop('images', None)
        restore_portrait_faces(skeleton, request['address'])
        helpers.save_bytes(root, folder + '/' + name + '.json', json.dumps(skeleton).encode())
        helpers.save_bytes(root, folder + '/' + name + '.atlas', atlas.encode())
        files.extend([folder + '/' + name + '.json', folder + '/' + name + '.atlas'])
        layers.append({'file': folder + '/' + name + '.json', 'atlas': folder + '/' + name + '.atlas',
                       'animations': list(skeleton.get('animations', {})), 'version': skeleton['skeleton'].get('spine'), 'mosaic': mode['mosaic'], 'x': 0, 'y': 0})
    if not layers or len(layers) != 1:
        raise ValueError('Expected one complete Spine renderer')
    animations = layers[0]['animations']
    default = 'Normal' if 'Normal' in animations else 'IdlingLoop' if 'IdlingLoop' in animations else animations[0] if animations else None
    return {'model': {'file': layers[0]['file'], 'layers': layers, 'animations': animations, 'defaultAnimation': default,
                      'version': layers[0]['version'], 'fit': 'bounds', 'exportVersion': export_version, 'files': files}}


def export(request, root, env):
    objects = list(env.objects)
    obj = matching_object(env, request)
    if request['kind'] == 'motions' or request['address'].startswith(('SCS/', 'SBC/')):
        return export_spine(env, request, root)
    if obj.type.name in ('GameObject', 'Sprite'):
        if obj.type.name == 'GameObject':
            obj = sprite_from_prefab(obj, objects)
        return {'image': helpers.image_file(root, obj.parse_as_object().image)}
    if obj.type.name == 'AudioClip':
        data = obj.parse_as_object()
        samples = list(data.samples.items())
        if len(samples) != 1:
            raise ValueError('Expected one voice clip')
        filename, sample = samples[0]
        suffix = pathlib.Path(filename).suffix.lower()
        if suffix not in ('.wav', '.ogg', '.mp3', '.m4a'):
            raise ValueError('Unsupported audio format')
        digest = hashlib.sha256(sample).hexdigest()
        return {'audio': {'file': helpers.save_bytes(root, 'audio/' + digest + suffix, sample), 'bytes': len(sample)}}
    raise ValueError('Unsupported catalog resource type')


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
        except Exception as error:
            for item in items:
                result['issues'].append({'address': item['address'], 'error': str(error)[:250]})
            continue
        for item in items:
            try:
                result['resources'].append({'address': item['address'], 'fingerprint': item['fingerprint'], **export(item, root, env)})
            except Exception as error:
                result['issues'].append({'address': item['address'], 'error': str(error)[:250]})
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
