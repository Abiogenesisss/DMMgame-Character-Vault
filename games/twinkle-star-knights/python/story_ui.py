"""Only the game's original UI sprites are written to the user's local library."""
import hashlib
import io
import json
from images import sprite_image, stretchable_sprite

SPRITES = {
    'message': 'message_bg', 'messageAdd': 'message_bg_add', 'fullMessage': 'message_bg_all',
    'name': 'name_bg', 'next': 'icon_click', 'nextAdd': 'icon_click_add',
    'auto': 'btn_adv_auto_off', 'autoOn': 'btn_adv_auto_on', 'speed': 'btn_adv_speed_off', 'speedOn': 'btn_adv_speed_on',
    'menu': 'btn_adv_menu', 'menuOn': 'btn_adv_menu_close', 'menuBg': 'adv_btn_bg',
    'log': 'btn_adv_log', 'hide': 'btn_adv_hidden', 'settings': 'btn_adv_setting', 'skip': 'btn_adv_skip',
    'reset': 'btn_adv_reset', 'mute': 'btn_adv_mute', 'voice': 'btn_adv_voice', 'voiceOn': 'btn_adv_voice_on',
    'window': 'adv_modal_window', 'logRow': 'common_base', 'choice': 'btn_select_01', 'choiceOn': 'btn_select_02',
    'modal': 'modal_window', 'panel': 'window_inner_A', 'close': 'btn_close', 'button': 'btn_common', 'confirm': 'btn_enter', 'selected': 'btn_select',
    'tabLeft': 'btn_tab_l_off', 'tabLeftOn': 'btn_tab_l_on', 'tabRight': 'btn_tab_r_off', 'tabRightOn': 'btn_tab_r_on',
    'minus': 'btn_minus_s', 'plus': 'btn_add_s', 'sound': 'btn_mute_off', 'soundOff': 'btn_mute_on', 'help': 'btn_help', 'slider': 'btn_slider',
}


def export_ui(env, root, save):
    available = {o.peek_name(): o for o in env.objects if o.type.name == 'Sprite'}
    sprites, files = {}, []
    for key, name in SPRITES.items():
        sprite = available[name].read()
        border = sprite.m_Border
        borders = [border.w, border.z, border.y, border.x]
        image = stretchable_sprite(sprite_image(sprite), borders)
        if key == 'logRow':
            # BackLogItem.Image in AdventureView: original vertex color.
            from PIL import Image
            image = Image.merge('RGBA', tuple(channel.point(lambda v, tint=tint: round(v * tint / 255)) for channel, tint in zip(image.convert('RGBA').split(), (77, 77, 141, 177))))
        stream = io.BytesIO()
        image.save(stream, format='PNG')
        content = stream.getvalue()
        file = save(root, 'story-ui/' + hashlib.sha256(content).hexdigest() + '.png', content)
        sprites[key] = {'file': file, 'width': image.width, 'height': image.height, 'border': [border.w, border.z, border.y, border.x]}
        files.append(file)
    # Measurements read from AdventureView / MessageWindow in the native client.
    theme = {'version': 3, 'width': 1280, 'height': 720, 'sprites': sprites}
    file = save(root, 'story-ui/theme.json', json.dumps(theme, ensure_ascii=False).encode('utf8'))
    return {'file': file, 'files': sorted(set(files + [file]))}
