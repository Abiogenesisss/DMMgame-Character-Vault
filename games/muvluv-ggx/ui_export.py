"""Extract only the novel window's UI graphics, font and serialized layout."""
import json
from PIL import Image
from UnityPy.export import SpriteHelper
from UnityPy.enums import SpritePackingRotation


def ui_sprite_image(sprite):
    """UI Images use atlas rectangles, not the unscaled sprite mesh UVs."""
    data = sprite.m_RD
    if sprite.m_SpriteAtlas:
        atlas = sprite.m_SpriteAtlas.deref_parse_as_object()
        data = next(value for key, value in atlas.m_RenderDataMap if key == sprite.m_RenderDataKey)
    texture = SpriteHelper.get_image(sprite, data.texture, data.alphaTexture)
    rect = data.textureRect
    # Variant atlases retain coordinates of their source atlas while the
    # texture itself is downscaled (DOTABYSS uses the 0.75 HD variant).
    scale = data.downscaleMultiplier or 1
    piece = texture.crop((round(rect.x * scale), round(rect.y * scale), round((rect.x + rect.width) * scale), round((rect.y + rect.height) * scale)))
    settings = SpriteHelper.SpriteSettings(data.settingsRaw)
    rotations = {SpritePackingRotation.kSPRFlipHorizontal: Image.Transpose.FLIP_LEFT_RIGHT,
                 SpritePackingRotation.kSPRFlipVertical: Image.Transpose.FLIP_TOP_BOTTOM,
                 SpritePackingRotation.kSPRRotate180: Image.Transpose.ROTATE_180,
                 SpritePackingRotation.kSPRRotate90: Image.Transpose.ROTATE_270}
    if settings.packed and settings.packingRotation in rotations:
        piece = piece.transpose(rotations[settings.packingRotation])
    width, height = round(sprite.m_Rect.width * scale), round(sprite.m_Rect.height * scale)
    if width <= 0 or height <= 0 or width * height > 32 * 1024 * 1024:
        raise ValueError('UI sprite exceeds size limit')
    canvas = Image.new('RGBA', (width, height))
    offset = data.textureRectOffset
    canvas.paste(piece, (round(offset.x * scale), round(offset.y * scale)))
    return canvas.transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((round(sprite.m_Rect.width), round(sprite.m_Rect.height)), Image.Resampling.LANCZOS)


def export_ui(env, root, helpers, ref, components, transform):
    selected = None
    for obj in env.objects:
        if obj.type.name != 'MonoBehaviour':
            continue
        data = obj.parse_as_dict()
        if '_r18Window' in data and '_novelLetterAdultPrefab' in data:
            selected = (obj, data)
            break
    if selected is None:
        raise ValueError('Original novel message window is missing')
    owner, data = selected
    files = []
    def game(pointer):
        obj = ref(owner, pointer)
        if obj.type.name != 'GameObject':
            obj = ref(obj, obj.parse_as_dict()['m_GameObject'])
        return obj
    def rect(obj):
        return transform(obj).parse_as_dict()
    def image(obj):
        for component in components(obj):
            if component.type.name != 'MonoBehaviour':
                continue
            props = component.parse_as_dict()
            if props.get('m_Sprite', {}).get('m_PathID'):
                sprite = ref(component, props['m_Sprite'])
                # Names are explicitly verified UI graphics, never CG textures.
                if sprite.peek_name() not in ['Common_Box_Grad', 'Icon_NovelMarker', 'Common_Line_H5']:
                    raise ValueError('Unexpected graphic in original UI window')
                parsed = sprite.parse_as_object()
                value = helpers.image_file(root, ui_sprite_image(parsed))
                files.append(value['file'])
                return {'file': value['file'], 'color': props['m_Color'], 'rect': rect(obj), 'sliced': props.get('m_Type') == 1,
                        'border': {'left': parsed.m_Border.x, 'bottom': parsed.m_Border.y, 'right': parsed.m_Border.z, 'top': parsed.m_Border.w}}
        return None
    def text(obj):
        for component in components(obj):
            if component.type.name != 'MonoBehaviour':
                continue
            props = component.parse_as_dict()
            if 'm_fontSize' not in props:
                continue
            result = {'fontSize': props['m_fontSize'], 'color': props.get('m_fontColor'), 'rect': rect(obj)}
            font_pointer = props.get('m_fontAsset', {})
            if font_pointer.get('m_PathID'):
                asset = ref(component, font_pointer)
                asset_data = asset.parse_as_dict()
                source = asset_data.get('m_SourceFontFile', {})
                if source.get('m_PathID'):
                    font = ref(asset, source).parse_as_dict()
                    raw = bytes(font.get('m_FontData', []))
                    if raw and len(raw) <= 32 * 1024 * 1024:
                        file = helpers.save_bytes(root, 'story-ui/dotabyss/original.ttf', raw)
                        files.append(file)
                        result['font'] = file
            return result
        return None
    boxes = data['_windowBox']
    adult = image(game(boxes[1]))
    normal = image(game(boxes[0]))
    name = text(game(data['_textNameAdult']))
    letter = data['_novelLetterAdultPrefab']
    if isinstance(letter, list):
        letter = letter[0]
    body = text(game(letter))
    marker = image(game(data['_novelKeyWaitIcon']))
    settings = next((obj.parse_as_dict() for obj in env.objects if obj.type.name == 'MonoBehaviour' and obj.peek_name() == 'NovelCommonSetting'), {})
    theme = {'version': 1, 'frame': {'width': 1920, 'height': 1080}, 'adult': adult, 'normal': normal, 'name': name, 'body': body,
             'marker': marker, 'messageHeight': 280.5, 'textLeft': 960 + data['_r18StartPos'], 'textWidth': 1248,
             'linePositions': data['_LineYPosPairs'], 'letterSpacing': data['_fontSpace'],
             'textSpeedRate': settings.get('DefaultWordSpeedRate', 25), 'autoWaitTime': settings.get('AutoWaitTimeMax', 1)}
    file = helpers.save_bytes(root, 'story-ui/dotabyss/theme.json', json.dumps(theme).encode())
    files.append(file)
    return {'ui': {'file': file, 'files': list(dict.fromkeys(files)), 'exportVersion': 4}}
