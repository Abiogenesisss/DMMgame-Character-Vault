"""Preserve Unity's premultiplied-alpha contract in exported Spine atlases."""

def mark_pma(atlas, premultiplied):
    lines = atlas.replace("\r\n", "\n").splitlines()
    result, header = [], False
    for line in lines:
        if line.strip().lower().endswith((".png", ".jpg")):
            header = True
            result.append(line)
            result.append("pma: " + ("true" if premultiplied else "false"))
            continue
        if header and line.strip().startswith("pma:"):
            continue
        if header and line.strip() and ":" not in line:
            header = False
        result.append(line)
    return "\n".join(result) + "\n"
