"""Local image and file export helpers."""
import hashlib
import io

def atlas_material_modes(objects):
    by_id = {obj.path_id: obj for obj in objects}
    modes = {}
    for obj in objects:
        if obj.type.name != "MonoBehaviour":
            continue
        data = obj.parse_as_dict()
        atlas = ref_id(data.get("atlasFile"))
        if not atlas or not data.get("materials"):
            continue
        material_modes = []
        for pointer in data["materials"]:
            material = by_id.get(ref_id(pointer))
            if material is None:
                raise ValueError("Spine material is missing")
            props = material.parse_as_dict()
            shader = by_id.get(ref_id(props.get("m_Shader")))
            if shader is None:
                raise ValueError("Spine shader is missing")
            shader = shader.parse_as_dict()["m_ParsedForm"]
            state = shader["m_SubShaders"][0]["m_Passes"][0]["m_State"]["rtBlend0"]
            pma = state["srcBlend"]["val"] == 1 and state["destBlend"]["val"] == 10
            material_modes.append({"pma": pma, "mosaic": "Mosaic" in shader["m_Name"]})
        if len({mode["pma"] for mode in material_modes}) != 1:
            raise ValueError("Spine atlas mixes incompatible alpha modes")
        modes[atlas] = {"pma": material_modes[0]["pma"], "mosaic": any(mode["mosaic"] for mode in material_modes)}
    return modes


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
