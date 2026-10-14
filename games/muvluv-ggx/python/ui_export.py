"""Extract only the novel window's UI graphics, font and serialized layout."""
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
    # texture itself is downscaled by the atlas variant.
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
