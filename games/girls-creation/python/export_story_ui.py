"""Extract UI sprites from local game bundles; never bundle artwork with code."""
import hashlib
import io
import json
import pathlib
import sys
import UnityPy
from PIL import Image
from UnityPy.export import SpriteHelper
from UnityPy.enums import SpritePackingRotation

SPRITES = {
    'message': 'MessageWindow', 'cgMessage': 'WhiteGradationFrame', 'cgLine': 'Line01Half', 'name': 'BaseName', 'next': 'DecoArrowBlack',
    'round': 'BtSM', 'roundOn': 'BtSMNormal', 'log': 'IconLog', 'auto': 'IconPlay',
    'autoOn': 'IconPlayOn', 'skip': 'IconSkip', 'hide': 'IconHide', 'settings': 'IconOption',
    'window': 'FrameMain', 'panel': 'TextFrame01', 'inset': 'BaseBeigeR8',
    'title': 'TitleM', 'titleLine': 'TitleDeco', 'chapter': 'titleBg',
    'button': 'BtMainWhite', 'buttonOn': 'BtMainYellow', 'reset': 'BtListGray',
    'line': 'Line01', 'check': 'IconCheckBox_off', 'checkOn': 'IconCheckBox_on',
    'artistFrame': 'UnitFrame_n', 'support3': 'SubCharaFrame_r',
    'support4': 'SubCharaFrame_sr', 'support5': 'SubCharaFrame_ssr',
}


def sprite_image(sprite):
    data = sprite.m_RD
    if sprite.m_SpriteAtlas:
        atlas = sprite.m_SpriteAtlas.read()
        data = next(value for key, value in atlas.m_RenderDataMap if key == sprite.m_RenderDataKey)
    texture = SpriteHelper.get_image(sprite, data.texture, data.alphaTexture)
    rect, scale = data.textureRect, data.downscaleMultiplier or 1
    piece = texture.crop((round(rect.x * scale), round(rect.y * scale), round((rect.x + rect.width) * scale), round((rect.y + rect.height) * scale)))
    settings = SpriteHelper.SpriteSettings(data.settingsRaw)
    rotations = {SpritePackingRotation.kSPRFlipHorizontal: Image.Transpose.FLIP_LEFT_RIGHT,
                 SpritePackingRotation.kSPRFlipVertical: Image.Transpose.FLIP_TOP_BOTTOM,
                 SpritePackingRotation.kSPRRotate180: Image.Transpose.ROTATE_180,
                 SpritePackingRotation.kSPRRotate90: Image.Transpose.ROTATE_270}
    if settings.packed and settings.packingRotation in rotations:
        piece = piece.transpose(rotations[settings.packingRotation])
    width, height = round(sprite.m_Rect.width * scale), round(sprite.m_Rect.height * scale)
    if width <= 0 or height <= 0 or width * height > 4 * 1024 * 1024:
        raise ValueError('UI sprite exceeds size limit')
    canvas = Image.new('RGBA', (width, height))
    canvas.paste(piece, (round(data.textureRectOffset.x * scale), round(data.textureRectOffset.y * scale)))
    return canvas.transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((round(sprite.m_Rect.width), round(sprite.m_Rect.height)), Image.Resampling.LANCZOS)


def main():
    request = json.load(sys.stdin)
    root = pathlib.Path(request['output']).resolve()
    env = UnityPy.Environment()
    for item in request['assets']:
        env.load_file(item['input'])
    available = {o.peek_name(): o for o in env.objects if o.type.name == 'Sprite'}
    sprites, files = {}, []
    for key, name in SPRITES.items():
        sprite = available[name].read()
        image = sprite_image(sprite)
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        content = stream.getvalue()
        file = 'story-ui/girls-creation/' + hashlib.sha256(content).hexdigest() + '.png'
        target = root / file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
        border = sprite.m_Border
        sprites[key] = {'file': file, 'width': image.width, 'height': image.height,
                        'border': [border.w, border.z, border.y, border.x]}
        files.append(file)
    # Layout uses the original 1920 x 1080 stage. Graphics are extracted above;
    # only these measurements and semantic bindings are part of the code.
    theme = {'version': 1, 'width': 1920, 'height': 1080, 'sprites': sprites}
    file = 'story-ui/girls-creation/theme.json'
    (root / file).write_text(json.dumps(theme, ensure_ascii=False), encoding='utf8')
    print(json.dumps({'file': file, 'files': sorted(set(files + [file])), 'frames': {
        'artist': sprites['artistFrame']['file'],
        'impression': {str(rarity): sprites['support' + str(rarity)]['file'] for rarity in (3, 4, 5)}}}))


if __name__ == '__main__':
    main()
