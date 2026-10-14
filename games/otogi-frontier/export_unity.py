"""Export images, complete Spine layers and audio; never execute Unity code."""
import hashlib
import io
import json
import pathlib
import re
import sys
import urllib.parse

import UnityPy
from UnityPy.files.ObjectReader import ObjectReader

from atlas_metadata import mark_pma


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


def export_bundle(request, root):
    env = UnityPy.load(request["input"])
    objects = list(env.objects)
    mode = request["kind"]
    results = {"images": [], "motions": [], "audio": []}
    if mode == "cg":
        expected = request.get("scene")
        bundle_names = [obj.parse_as_object().m_Name for obj in objects if obj.type.name == "AssetBundle"]
        if not expected or bundle_names != ["chara/still/" + expected]:
            raise ValueError("CG bundle ID does not match the requested scene")
    elif mode == "voices":
        url = urllib.parse.urlsplit(request["url"])
        prefix = "/prodassets/GeneralWebGL/Assets/"
        resource = url.path.removeprefix(prefix)
        match = re.fullmatch(r"sound/voice/(still|adventure)/voice_\1_(\d{4,8})", resource)
        bundle_names = [obj.parse_as_object().m_Name for obj in objects if obj.type.name == "AssetBundle"]
        if url.hostname != "web-assets.otogi-frontier.com" or not url.path.startswith(prefix) or not match or match[2] != request.get("scene") or bundle_names != [resource]:
            raise ValueError("Voice bundle ID does not match the requested scene")
    if mode == "icons":
        # Atlas object parsing and decoded texture caching must be bounded.
        # Re-reading a 3,000-sprite atlas for every icon is otherwise expensive.
        original = ObjectReader.parse_as_object
        atlas_cache = {}

        def cached(reader, *args, **kwargs):
            if reader.type.name != "SpriteAtlas":
                return original(reader, *args, **kwargs)
            key = (id(reader.assets_file), reader.path_id)
            if key not in atlas_cache:
                atlas_cache[key] = original(reader, *args, **kwargs)
            return atlas_cache[key]

        ObjectReader.parse_as_object = cached
        try:
            wanted = request.get("sprites", {})
            chosen = {}
            for obj in objects:
                if obj.type.name != "Sprite" or obj.peek_name() not in wanted:
                    continue
                name = obj.peek_name()
                owner = wanted[name]
                score = (name != owner, int(name))
                if owner not in chosen or score < chosen[owner][0]:
                    chosen[owner] = (score, obj)
            sprites = []
            for _, obj in chosen.values():
                data = obj.parse_as_object()
                atlas = data.m_SpriteAtlas.deref_parse_as_object() if data.m_SpriteAtlas else None
                render = next(value for key, value in atlas.m_RenderDataMap if key == data.m_RenderDataKey) if atlas else data.m_RD
                sprites.append((render.texture.path_id, data))
            sprites.sort(key=lambda item: item[0])
            current_texture = None
            for texture_id, data in sprites:
                if texture_id != current_texture:
                    for file in env.files.values():
                        for child in getattr(file, "files", {}).values():
                            if hasattr(child, "_cache"):
                                child._cache.clear()
                    current_texture = texture_id
                result = image_file(root, data.image)
                result.update({"category": "icon", "character": wanted[data.m_Name], "sprite": data.m_Name})
                results["images"].append(result)
        finally:
            ObjectReader.parse_as_object = original
    elif mode == "portraits":
        sprites = [o for o in objects if o.type.name == "Sprite"]
        main = next((o for o in sprites if re.fullmatch(r"_stand\d+", o.peek_name() or "")), None)
        if main is None:
            main = next((o for o in sprites if (o.peek_name() or "").isdigit()), None)
        if main is None:
            raise ValueError("Bundle has no full portrait sprite")
        result = image_file(root, main.parse_as_object().image)
        result.update({"category": "portrait", "sprite": main.peek_name()})
        results["images"].append(result)
    elif mode == "backgrounds":
        textures = [obj for obj in objects if obj.type.name == "Texture2D" and obj.peek_name() != "DummySprite"]
        if not textures:
            raise ValueError("Background texture is missing")
        texture = max(textures, key=lambda obj: obj.parse_as_object().m_Width * obj.parse_as_object().m_Height)
        result = image_file(root, texture.parse_as_object().image)
        result.update({"category": "background", "sprite": texture.peek_name()})
        results["images"].append(result)
    elif mode == "cg":
        material_modes = atlas_material_modes(objects)
        texts, skeletons = {}, {}
        for obj in objects:
            if obj.type.name != "TextAsset":
                continue
            data = obj.parse_as_object()
            script = data.m_Script.decode("utf-8") if isinstance(data.m_Script, bytes) else data.m_Script
            if len(script) > 8 * 1024 * 1024:
                raise ValueError("Spine data exceeds limit")
            texts[obj.path_id] = (data.m_Name, script)
            try:
                parsed = json.loads(script)
            except json.JSONDecodeError:
                continue
            if isinstance(parsed, dict) and "skeleton" in parsed and "bones" in parsed:
                skeletons[obj.path_id] = (data.m_Name, parsed)
        textures = {obj.peek_name(): obj for obj in objects if obj.type.name == "Texture2D"}
        if not skeletons:
            for name, obj in textures.items():
                if name == "DummySprite" or name.startswith("sactx-"):
                    continue
                image = image_file(root, obj.parse_as_object().image)
                image.update({"category": "cg", "sprite": name})
                results["images"].append(image)
        else:
            folder = "spine/cg-" + request["body"]
            layers = []
            components, transforms, transform_ids, renderers = {}, {}, {}, {}
            for obj in objects:
                if obj.type.name not in ("MonoBehaviour", "Transform", "MeshRenderer"):
                    continue
                data = obj.parse_as_dict()
                if obj.type.name == "MonoBehaviour":
                    components[obj.path_id] = data
                elif obj.type.name == "Transform":
                    transforms[ref_id(data.get("m_GameObject"))] = data
                    transform_ids[obj.path_id] = data
                else:
                    renderers[ref_id(data.get("m_GameObject"))] = data
            for component in components.values():
                source = components.get(ref_id(component.get("skeletonDataAsset")), {})
                skeleton_id = ref_id(source.get("skeletonJSON"))
                if skeleton_id not in skeletons:
                    continue
                name, skeleton = skeletons[skeleton_id]
                if not re.fullmatch(r"[A-Za-z0-9_.-]+", name):
                    raise ValueError("Unsafe Spine asset name")
                atlas = next((text for text_name, text in texts.values() if text_name == name + ".atlas"), None)
                if not atlas:
                    raise ValueError("Spine atlas is missing")
                atlas_id = next(key for key, value in texts.items() if value[0] == name + ".atlas")
                alpha_mode = material_modes.get(atlas_id)
                if alpha_mode is None:
                    raise ValueError("Spine atlas material is not associated")
                atlas = mark_pma(atlas, alpha_mode["pma"])
                pages = [line.strip() for line in atlas.splitlines() if line.strip().lower().endswith((".png", ".jpg"))]
                for page in pages:
                    if not re.fullmatch(r"[A-Za-z0-9_.-]+", page):
                        raise ValueError("Unsafe Spine texture path")
                    texture = textures.get(pathlib.Path(page).stem)
                    if texture is None:
                        raise ValueError("Spine texture is missing")
                    image = texture.parse_as_object().image
                    stream = io.BytesIO()
                    image.save(stream, format="PNG")
                    save_bytes(root, folder + "/" + page, stream.getvalue())
                skeleton["skeleton"].pop("images", None)
                save_bytes(root, folder + "/" + name + ".json", json.dumps(skeleton).encode())
                save_bytes(root, folder + "/" + name + ".atlas", atlas.encode())
                game_object = ref_id(component.get("m_GameObject"))
                transform = transforms.get(game_object, {})
                position = transform.get("m_LocalPosition", {})
                scale = transform.get("m_LocalScale", {})
                rotation = transform.get("m_LocalRotation", {})
                if abs(rotation.get("x", 0)) > 0.0001 or abs(rotation.get("y", 0)) > 0.0001 or abs(rotation.get("z", 0)) > 0.0001:
                    raise ValueError("Spine layer uses an unsupported rotation")
                parent_id = ref_id(transform.get("m_Father"))
                seen = set()
                while parent_id:
                    if parent_id in seen or parent_id not in transform_ids:
                        raise ValueError("Invalid Spine hierarchy")
                    seen.add(parent_id)
                    parent = transform_ids[parent_id]
                    if any(abs(parent.get("m_LocalPosition", {}).get(axis, 0)) > 0.0001 or abs(parent.get("m_LocalScale", {}).get(axis, 1) - 1) > 0.0001 for axis in ["x", "y"]):
                        raise ValueError("Spine parent has unsupported placement")
                    parent_id = ref_id(parent.get("m_Father"))
                unit_scale = float(source.get("scale", 0.01))
                if unit_scale <= 0:
                    raise ValueError("Invalid Spine layer scale")
                layers.append({"file": folder + "/" + name + ".json", "x": position.get("x", 0) / unit_scale, "y": -position.get("y", 0) / unit_scale,
                    "scaleX": scale.get("x", 1) * (-1 if component.get("initialFlipX") else 1), "scaleY": scale.get("y", 1) * (-1 if component.get("initialFlipY") else 1),
                    "order": renderers.get(game_object, {}).get("m_SortingOrder", 0), "animations": list(skeleton.get("animations", {})), "version": skeleton["skeleton"].get("spine"),
                    "mosaic": alpha_mode["mosaic"]})
            if len(layers) != len(skeletons):
                raise ValueError("Not every Spine layer is associated with the scene")
            layers.sort(key=lambda layer: layer["order"])
            animations = [animation for animation in layers[0]["animations"] if all(animation in layer["animations"] for layer in layers)]
            if not animations:
                raise ValueError("Spine layers have no shared animation")
            results["motions"].append({"file": layers[0]["file"], "layers": layers, "animations": animations, "version": layers[0]["version"], "fit": "bounds", "exportVersion": 2})
    elif mode in ("voices", "music", "sound"):
        for obj in sorted((item for item in objects if item.type.name == "AudioClip"), key=lambda item: item.peek_name()):
            data = obj.parse_as_object()
            for filename, sample in data.samples.items():
                # UnityPy/FMOD emits standalone WAV/OGG/MP3 bytes. Store by hash.
                suffix = pathlib.Path(filename).suffix.lower()
                if suffix not in (".wav", ".ogg", ".mp3", ".m4a"):
                    raise ValueError("Unsupported exported voice format")
                digest = hashlib.sha256(sample).hexdigest()
                file = save_bytes(root, "audio/" + digest + suffix, sample)
                results["audio"].append({"id": digest, "file": file, "name": data.m_Name, "bytes": len(sample)})
    if not any(results.values()):
        raise ValueError("Bundle contains no matching resources")
    return results


def main():
    request = json.load(sys.stdin)
    root = pathlib.Path(request["output"]).resolve()
    root.mkdir(parents=True, exist_ok=True)
    result = {"resources": [], "issues": []}
    for item in request["bundles"]:
        try:
            result["resources"].append({"body": item["body"], "url": item["url"], **export_bundle(item, root)})
        except Exception as error:
            result["issues"].append({"resource": item["url"], "error": str(error)[:300]})
    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
