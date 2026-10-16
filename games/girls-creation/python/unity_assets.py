"""Local image and file export helpers."""
import hashlib
import io

def save_bytes(root, relative, data):
    target = (root / relative).resolve()
    if not target.is_relative_to(root.resolve()):
        raise ValueError("Unsafe export path")
    target.parent.mkdir(parents=True, exist_ok=True)
    if not target.exists() or target.read_bytes() != data:
        temporary = target.with_name(target.name + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(target)
    return relative


def image_file(root, image):
    if image.width * image.height > 32 * 1024 * 1024 or not image.width or not image.height:
        raise ValueError("Texture dimensions exceed limit")
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    data = stream.getvalue()
    digest = hashlib.sha256(data).hexdigest()
    file = save_bytes(root, "images/" + digest + ".png", data)
    return {"id": digest, "file": file, "width": image.width, "height": image.height, "bytes": len(data)}


def ref_id(value):
    return value.get("m_PathID", 0) if isinstance(value, dict) else 0
