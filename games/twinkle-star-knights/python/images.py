"""Restore Unity's trimmed sprite canvas before cutting frames or nine-slicing."""
from PIL import Image
from UnityPy.export import SpriteHelper
from UnityPy.enums import SpritePackingRotation


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
    if width <= 0 or height <= 0 or width * height > 32 * 1024 * 1024:
        raise ValueError('Sprite dimensions exceed limit')
    canvas = Image.new('RGBA', (width, height))
    canvas.paste(piece, (round(data.textureRectOffset.x * scale), round(data.textureRectOffset.y * scale)))
    return canvas.transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((round(sprite.m_Rect.width), round(sprite.m_Rect.height)), Image.Resampling.LANCZOS)


def stretchable_sprite(picture, border):
    """Give Unity's zero-width center UV a real texel for CSS nine-slicing."""
    top, right, bottom, left = map(round, border)
    if left + right == picture.width:
        at = min(max(1, left), picture.width - 1)
        result = Image.new('RGBA', (picture.width + 1, picture.height))
        result.paste(picture.crop((0, 0, at, picture.height)), (0, 0))
        result.paste(picture.crop((at - 1, 0, at, picture.height)), (at, 0))
        result.paste(picture.crop((at, 0, picture.width, picture.height)), (at + 1, 0))
        picture = result
    if top + bottom == picture.height:
        at = min(max(1, top), picture.height - 1)
        result = Image.new('RGBA', (picture.width, picture.height + 1))
        result.paste(picture.crop((0, 0, picture.width, at)), (0, 0))
        result.paste(picture.crop((0, at - 1, picture.width, at)), (0, at))
        result.paste(picture.crop((0, at, picture.width, picture.height)), (0, at + 1))
        picture = result
    return picture
