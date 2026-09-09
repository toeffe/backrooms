import { ITEM_DEFS } from '../systems/Inventory.js';

export class UIController {
  constructor(bus) {
    this.bus = bus;
    this.el = {
      menu: document.getElementById('menu'),
      hud: document.getElementById('hud'),
      crosshair: document.getElementById('crosshair'),
      interactPrompt: document.getElementById('interact-prompt'),
      vitals: document.getElementById('vitals'),
      barFlashlight: document.getElementById('bar-flashlight'),
      barStamina: document.getElementById('bar-stamina'),
      zoneLabel: document.getElementById('zone-label'),
      messageLog: document.getElementById('message-log'),
      fearVignette: document.getElementById('fear-vignette'),
      jumpscare: document.getElementById('jumpscare'),
      fade: document.getElementById('fade'),
      inventory: document.getElementById('inventory'),
      invGrid: document.getElementById('inv-grid'),
      invDetail: document.getElementById('inv-detail'),
      mapview: document.getElementById('mapview'),
      mapCanvas: document.getElementById('map-canvas'),
      loading: document.getElementById('loading'),
      noclip: document.getElementById('noclip-flag'),
      pause: document.getElementById('pause-menu'),
      clickToPlay: document.getElementById('click-to-play'),
      settings: document.getElementById('settings-panel'),
    };
    this.messages = [];
    this._bindBusEvents();
  }

  _bindBusEvents() {
    this.bus.on('message', (msg) => this.pushMessage(msg));
    this.bus.on('inventory-changed', (slots) => this.renderInventory(slots));
    this.bus.on('noclip', (on) => this.setNoclip(on));
    this.bus.on('zone-enter', (zone) => this.setZoneLabel(zone));
  }

  showLoading(show) {
    this.el.loading.style.display = show ? 'flex' : 'none';
  }

  showMenu(show) {
    this.el.menu.style.display = show ? 'flex' : 'none';
  }

  setContinueEnabled(enabled) {
    document.getElementById('btn-continue').style.opacity = enabled ? '1' : '0.35';
    document.getElementById('btn-continue').style.pointerEvents = enabled ? 'auto' : 'none';
  }

  showHUD(show) {
    this.el.hud.classList.toggle('active', show);
  }

  showPause(show) {
    if (!this.el.pause) return;
    this.el.pause.classList.toggle('active', !!show);
  }

  isPaused() {
    return !!this.el.pause?.classList.contains('active');
  }

  showClickToPlay(show) {
    if (!this.el.clickToPlay) return;
    this.el.clickToPlay.classList.toggle('active', !!show);
  }

  isClickToPlay() {
    return !!this.el.clickToPlay?.classList.contains('active');
  }

  showSettings(show) {
    if (!this.el.settings) return;
    this.el.settings.classList.toggle('active', !!show);
  }

  isSettingsOpen() {
    return !!this.el.settings?.classList.contains('active');
  }

  fadeIn() {
    this.el.fade.classList.add('clear');
  }
  fadeOut(cb) {
    this.el.fade.classList.remove('clear');
    if (cb) setTimeout(cb, 2200);
  }

  setCrosshairVisible(v) {
    this.el.crosshair.classList.toggle('show', v);
  }

  setInteractPrompt(text) {
    if (!text) {
      this.el.interactPrompt.classList.remove('show');
      return;
    }
    this.el.interactPrompt.textContent = text;
    this.el.interactPrompt.classList.add('show');
  }

  updateVitals(flashlightPct, staminaPct) {
    this.el.barFlashlight.style.width = `${flashlightPct}%`;
    this.el.barFlashlight.classList.toggle('low', flashlightPct < 20);
    this.el.barStamina.style.width = `${staminaPct}%`;
    this.el.barStamina.classList.toggle('low', staminaPct < 20);
  }

  setNoclip(on) {
    if (!this.el.noclip) return;
    this.el.noclip.classList.toggle('show', !!on);
  }

  setZoneLabel(zone) {
    if (!this.el.zoneLabel) return;
    const text = zone?.label || '';
    this.el.zoneLabel.textContent = text;
    this.el.zoneLabel.classList.toggle('show', !!text);
    clearTimeout(this._zoneHide);
    if (text) {
      this._zoneHide = setTimeout(() => {
        if (this.el.zoneLabel) this.el.zoneLabel.classList.remove('show');
      }, 4200);
    }
  }

  pushMessage(msg) {
    const line = document.createElement('div');
    line.className = 'line';
    line.textContent = msg;
    this.el.messageLog.appendChild(line);
    this.messages.push(line);
    setTimeout(() => {
      line.style.transition = 'opacity 1.2s';
      line.style.opacity = '0';
      setTimeout(() => line.remove(), 1300);
    }, 4200);
  }

  setFear(level) {
    const spread = 6 + level * 14;
    const blur = 18 + level * 10;
    this.el.fearVignette.style.boxShadow = `inset 0 0 ${blur}vw ${spread}vw rgba(80,0,0,${level * 0.35})`;
  }

  triggerJumpscare(_kind = 'pit') {
    const el = this.el.jumpscare;
    if (!el) return;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 600);
  }

  toggleInventory(force) {
    const active = force !== undefined ? force : !this.el.inventory.classList.contains('active');
    this.el.inventory.classList.toggle('active', active);
    return active;
  }

  renderInventory(slots) {
    this.el.invGrid.innerHTML = '';
    for (let i = 0; i < 10; i++) {
      const slotEl = document.createElement('div');
      slotEl.className = 'slot';
      const item = slots[i];
      if (item) {
        const def = ITEM_DEFS[item.defKey] || { name: item.defKey };
        slotEl.classList.add('filled');
        slotEl.textContent = def.name;
        if (def.usable) slotEl.classList.add('usable');
        slotEl.addEventListener('click', () => {
          this.el.invDetail.textContent = def.desc || '';
        });
      }
      this.el.invGrid.appendChild(slotEl);
    }
  }

  toggleMap(force) {
    const active = force !== undefined ? force : !this.el.mapview.classList.contains('active');
    this.el.mapview.classList.toggle('active', active);
    return active;
  }

  isAnyPanelOpen() {
    return this.el.inventory.classList.contains('active') ||
           this.el.mapview.classList.contains('active') ||
           this.isPaused() ||
           this.isSettingsOpen();
  }
}
