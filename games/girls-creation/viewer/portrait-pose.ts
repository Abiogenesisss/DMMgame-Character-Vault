// The game uses independent Spine tracks: body, expression, blink, mouth.
// Applying only `loop` leaves the facial attachment slots empty.
export class PortraitPose {
  expression = '';
  body = '';
  talking = false;
  token: any;
  blinkTimer: any;
  constructor(private spine, private names: string[]) {}
  set(animation = 'loop', expression = animation, loop = true, token: any = null) {
    const body = this.names.includes(animation) ? animation : 'loop';
    const face = this.names.includes('ex_' + expression) ? expression : 'loop';
    if (this.body !== body || this.token !== token) {
      this.spine.state.setAnimation(0, body, loop); this.body = body; this.token = token;
    }
    if (this.expression !== face) {
      this.spine.state.clearTrack(2); this.spine.state.clearTrack(3);
      if (this.names.includes('ex_' + face)) this.spine.state.setAnimation(1, 'ex_' + face, true);
      this.expression = face; this.setTalking(this.talking, true); this.scheduleBlink();
    }
    this.spine.update(0);
  }
  setTalking(value: boolean, force = false) {
    if (value === this.talking && !force) return;
    this.talking = value;
    const name = 'mo_' + this.expression;
    if (value && this.names.includes(name)) this.spine.state.setAnimation(3, name, true);
    else this.spine.state.setEmptyAnimation(3, 0);
  }
  scheduleBlink() {
    clearTimeout(this.blinkTimer);
    this.blinkTimer = setTimeout(() => {
      const name = 'wi_' + this.expression;
      if (this.names.includes(name)) {
        this.spine.state.setAnimation(2, name, false);
        this.spine.state.addEmptyAnimation(2, 0, 0);
      }
      this.scheduleBlink();
    }, 2800 + Math.random() * 1800);
  }
  destroy() { clearTimeout(this.blinkTimer); }
}
