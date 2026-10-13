import './hud.css';

/**
 * Everything on screen over the room. Plain DOM, styled in hud.css, positioned in stage
 * coordinates so it turns with the page on a phone held upright (see mobile.ts).
 */

export interface PromptAction { label: string; key: string; run: () => void }

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent: HTMLElement = document.body, html = '') => {
  const e = document.createElement(tag);
  e.className = cls;
  if (html) e.innerHTML = html;
  parent.append(e);
  return e;
};

const ICON = {
  mic: '<svg viewBox="0 0 24 24"><path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor"/><path d="m16 9 5 6m0-6-5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5V14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/></svg>',
};

export class Hud {
  private loading: HTMLElement;
  private bar: HTMLElement;
  private prompt: HTMLElement;
  private captionEl: HTMLElement;
  private captionTimer = 0;
  private lyricsEl: HTMLElement;
  private bannerEl: HTMLElement;
  private help: HTMLElement;
  private micBtn: HTMLButtonElement;
  private micMeter: HTMLElement;
  private soundBtn: HTMLButtonElement;
  private cardEl: HTMLElement;
  private promptKey = '';
  private actions: PromptAction[] = [];
  onMic?: () => void;
  onSound?: () => void;

  constructor(private name: string, touch: boolean) {
    document.documentElement.classList.add('bd');
    this.loading = el('div', 'bd-loading', document.body, `
      <div class="bd-cupcake" aria-hidden="true">
        <svg viewBox="0 0 64 64"><path d="M14 30h36l-5 26H19z" fill="#e8a27c"/><path d="M20 30l3 26M28 30l1 26M36 30l-1 26M44 30l-3 26" stroke="#d48b65" stroke-width="2"/>
        <path d="M12 31c-3-9 6-15 12-13 2-7 14-9 18-2 7-1 12 6 9 14z" fill="#ffd1dc"/><circle cx="32" cy="12" r="4" fill="#e64b5d"/></svg>
      </div>
      <div class="bd-load-title">Getting the party ready…</div>
      <div class="bd-track"><div class="bd-bar"></div></div>`);
    this.bar = this.loading.querySelector('.bd-bar')!;
    this.prompt = el('div', 'bd-prompt');
    this.captionEl = el('div', 'bd-caption');
    this.lyricsEl = el('div', 'bd-lyrics');
    this.bannerEl = el('div', 'bd-banner', document.body, `<div class="small">Happy Birthday</div><div class="big"></div>`);
    this.bannerEl.querySelector('.big')!.textContent = name;
    this.help = el('div', 'bd-help', document.body, touch
      ? `<span>Left thumb: walk</span><span>Tap glowing things</span><span>Drag right side: look</span>`
      : `<span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> walk</span><span><kbd>E</kbd> interact</span><span><kbd>drag</kbd> look</span><span><kbd>T</kbd> twirl</span><span><kbd>G</kbd> wave</span>`);
    const tools = el('div', 'bd-tools');
    this.micBtn = el('button', 'bd-btn bd-mic', tools, ICON.mic + '<i class="bd-meter"></i>') as HTMLButtonElement;
    this.micBtn.title = 'Blow out the candles with your microphone';
    this.micBtn.setAttribute('aria-label', this.micBtn.title);
    this.micMeter = this.micBtn.querySelector('.bd-meter')!;
    this.soundBtn = el('button', 'bd-btn', tools, ICON.sound) as HTMLButtonElement;
    this.soundBtn.title = 'Sound on / off';
    this.soundBtn.setAttribute('aria-label', 'Mute');
    this.soundBtn.setAttribute('aria-pressed', 'false');
    this.micBtn.setAttribute('aria-pressed', 'false');
    const helpBtn = el('button', 'bd-btn', tools, ICON.help) as HTMLButtonElement;
    helpBtn.title = 'Controls';
    helpBtn.setAttribute('aria-label', 'Show controls');
    helpBtn.onclick = () => this.showHelp(true);
    this.micBtn.onclick = () => this.onMic?.();
    this.soundBtn.onclick = () => this.onSound?.();
    for (const b of [this.micBtn, this.soundBtn, helpBtn]) b.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.cardEl = el('div', 'bd-card-wrap');
    addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || this.cardEl.classList.contains('open')) return;
      const a = this.actions.find((x) => x.key.toLowerCase() === e.key.toLowerCase());
      if (a) { e.preventDefault(); a.run(); }
    });
  }

  setProgress(p: number) { this.bar.style.width = `${Math.round(p * 100)}%`; }
  /** the room could not load: say so on the loading screen itself */
  loadFailed(msg: string) {
    this.loading.querySelector('.bd-load-title')!.textContent = msg;
    this.loading.querySelector('.bd-track')?.remove();
    this.loading.querySelector('.bd-cupcake')?.classList.add('still');
  }

  hideLoading() {
    this.loading.classList.add('hide');
    setTimeout(() => this.loading.remove(), 1000);
    setTimeout(() => this.showHelp(true), 900);
  }

  showHelp(on: boolean) {
    this.help.classList.toggle('show', on);
    clearTimeout((this.help as any)._t);
    if (on) (this.help as any)._t = setTimeout(() => this.help.classList.remove('show'), 9000);
  }

  /** the action chips for whatever she is next to; null hides them */
  setPrompt(title: string | null, actions: PromptAction[]) {
    const key = title ? title + '|' + actions.map((a) => a.label).join('|') : '';
    this.actions = title ? actions : [];
    if (key === this.promptKey) return;
    this.promptKey = key;
    if (!title) { this.prompt.classList.remove('show'); return; }
    this.prompt.innerHTML = '';
    const t = el('div', 'bd-prompt-title', this.prompt); t.textContent = title;
    const row = el('div', 'bd-chips', this.prompt);
    for (const a of actions) {
      const b = el('button', 'bd-chip', row) as HTMLButtonElement;
      b.innerHTML = `<kbd></kbd><span></span>`;
      b.querySelector('kbd')!.textContent = a.key.toUpperCase();
      b.querySelector('span')!.textContent = a.label;
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      b.onclick = () => a.run();
    }
    this.prompt.classList.remove('show');
    void this.prompt.offsetWidth;
    this.prompt.classList.add('show');
  }

  caption(text: string, seconds = 3) {
    this.captionEl.textContent = text;
    this.captionEl.classList.add('show');
    clearTimeout(this.captionTimer);
    if (seconds > 0) this.captionTimer = window.setTimeout(() => this.captionEl.classList.remove('show'), seconds * 1000);
  }
  hideCaption() { clearTimeout(this.captionTimer); this.captionEl.classList.remove('show'); }

  private lyricText = '';
  lyric(text: string | null, isName = false) {
    if ((text ?? '') === this.lyricText) return;
    this.lyricText = text ?? '';
    if (!text) { this.lyricsEl.classList.remove('show'); return; }
    // the name gets its own sparkle
    const esc = (t: string) => t.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
    const safe = esc(text), nm = esc(this.name);
    // (a function, so `$&` and the like in a name are taken literally)
    this.lyricsEl.innerHTML = isName ? safe.replace(nm, () => `<b>${nm}</b>`) : safe;
    this.lyricsEl.classList.remove('show');
    void this.lyricsEl.offsetWidth;
    this.lyricsEl.classList.add('show');
  }

  banner(state: 'hidden' | 'big' | 'small') {
    this.bannerEl.classList.toggle('show', state !== 'hidden');
    this.bannerEl.classList.toggle('small', state === 'small');
  }

  private micState = '';
  private micLevel = -1;
  /** called every frame while the mic listens: only touches the DOM when something shows a change */
  setMic(state: 'off' | 'on' | 'denied', level = 0) {
    if (state !== this.micState) {
      this.micState = state;
      this.micBtn.classList.toggle('on', state === 'on');
      this.micBtn.classList.toggle('denied', state === 'denied');
      this.micBtn.setAttribute('aria-pressed', String(state === 'on'));
    }
    const q = Math.round(Math.min(1, level) * 40) / 40;
    if (q !== this.micLevel) { this.micLevel = q; this.micMeter.style.transform = `scaleY(${q})`; }
  }
  setSound(on: boolean) {
    this.soundBtn.innerHTML = on ? ICON.sound : ICON.muted;
    this.soundBtn.setAttribute('aria-pressed', String(!on));
  }

  /** the birthday card, opened like a real one; resolves when closed */
  showCard(): Promise<void> {
    return new Promise((resolve) => {
      this.cardEl.innerHTML = `
        <div class="bd-card" role="dialog" aria-label="Birthday card">
          <div class="bd-card-inside">
            <p class="hi"></p>
            <p>Happy Birthday! 🎂</p>
            <p>I hope this year brings you endless laughter, cosy days, brave little adventures and every small thing that makes you smile.</p>
            <p>Keep being exactly the wonderful person you are — the world is brighter with you in it.</p>
            <p class="sign">Have the sweetest day ✨</p>
            <p class="deco" aria-hidden="true">🎈🎂🎁</p>
          </div>
          <div class="bd-card-cover"><div class="for">for</div><div class="nm"></div><div class="star">★</div></div>
          <button class="bd-card-close" aria-label="Close the card">×</button>
        </div>`;
      this.cardEl.querySelector('.hi')!.textContent = `Dear ${this.name},`;
      this.cardEl.querySelector('.nm')!.textContent = this.name;
      this.cardEl.classList.add('open');
      // a forced reflow commits the closed state, so adding `unfold` animates from it
      void this.cardEl.offsetWidth;
      this.cardEl.classList.add('unfold');
      let closed = false;
      const close = () => {
        if (closed) return;
        closed = true;
        clearTimeout(arm);
        removeEventListener('keydown', onKey);
        this.cardEl.classList.remove('unfold');
        setTimeout(() => { this.cardEl.classList.remove('open'); this.cardEl.innerHTML = ''; resolve(); }, 600);
      };
      const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ' || e.key.toLowerCase() === 'e') { e.preventDefault(); close(); } };
      // keys close it only after a moment, so the key that opened it does not also close it
      const arm = window.setTimeout(() => { if (!closed) addEventListener('keydown', onKey); }, 300);
      this.cardEl.querySelector<HTMLButtonElement>('.bd-card-close')!.onclick = close;
      this.cardEl.onclick = (e) => { if (e.target === this.cardEl) close(); };
    });
  }
  get cardOpen() { return this.cardEl.classList.contains('open'); }
}
