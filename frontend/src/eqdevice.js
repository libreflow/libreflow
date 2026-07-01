// eqdevice.js — Profils EQ automatiques par appareil audio de sortie.
//
// Détecte le changement d'appareil via devicechange + enumerateDevices().
// Charge automatiquement le profil EQ enregistré pour l'appareil branché.
// Les profils sont persistés dans cfg sous la clé eqDeviceProfiles.
//
// Pas d'import de cfgsave.js pour éviter la dépendance circulaire :
// les mutations appellent saveCfg() depuis handlers.js après retour.
//
// Exports :
//   initDeviceEQ(savedProfiles)    — boot : charge profils + écoute devicechange
//   getDeviceProfiles()            — { [deviceId]: { bands, label } }
//   getActiveDeviceId()            — deviceId courant ('' = défaut OS)
//   getActiveDeviceLabel()         — label lisible ou fallback
//   saveCurrentDeviceProfile()     — enregistre les gains actuels pour l'appareil courant
//   deleteDeviceProfile(deviceId)  — supprime un profil
//   renderDeviceProfiles()         — met à jour la section UI dans #set-page-audio

import { eqNodes, applyEQGains } from './eq.js';
import { esc }                    from './ui.js';

// ── État module ───────────────────────────────────────────────────────────────
/** @type {{ [deviceId: string]: { bands: number[], label: string } }} */
let _deviceProfiles = {};
let _activeId       = '';   // deviceId courant — '' = sortie par défaut OS
let _activeLabel    = '';   // label lisible du device actuel
let _knownIds       = [];   // snapshot des audiooutput deviceIds pour détection ajout/retrait

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Appelé au boot par app.js après chargement des profils depuis IDB.
 * Lance la détection du device courant et écoute les changements.
 * @param {Object} savedProfiles — cfg.eqDeviceProfiles ou {}
 */
export async function initDeviceEQ(savedProfiles) {
  if (savedProfiles && typeof savedProfiles === 'object') {
    _deviceProfiles = { ...savedProfiles };
  }
  await _refreshActiveDevice();
  if (navigator.mediaDevices) {
    navigator.mediaDevices.addEventListener('devicechange', _onDeviceChange);
  }
}

// ── Getters ───────────────────────────────────────────────────────────────────

/** @returns {{ [deviceId: string]: { bands: number[], label: string } }} */
export function getDeviceProfiles() {
  return { ..._deviceProfiles };
}

/** @returns {string} deviceId courant ('' = sortie par défaut OS) */
export function getActiveDeviceId() {
  return _activeId;
}

/** @returns {string} Label lisible ou fallback */
export function getActiveDeviceLabel() {
  if (_activeLabel) return _activeLabel;
  if (_activeId && _activeId !== 'default') return `ID:${_activeId.slice(0, 8)}`;
  return 'Sortie par défaut';
}

// ── Mutations (sans saveCfg — appelé par handlers.js après) ──────────────────

/**
 * Enregistre les gains EQ actuels pour l'appareil actif.
 * N'appelle PAS saveCfg — le handler doit le faire après.
 */
export function saveCurrentDeviceProfile() {
  const bands = eqNodes.length
    ? eqNodes.map(n => n.gain.value)
    : new Array(10).fill(0);
  _deviceProfiles[_activeId || 'default'] = {
    bands,
    label: _activeLabel || getActiveDeviceLabel(),
  };
  renderDeviceProfiles();
}

/**
 * Supprime le profil d'un appareil par son deviceId.
 * N'appelle PAS saveCfg — le handler doit le faire après.
 * @param {string} deviceId
 */
export function deleteDeviceProfile(deviceId) {
  if (!deviceId) return; // guard against deleting the '' key accidentally
  delete _deviceProfiles[deviceId];
  renderDeviceProfiles();
}

// ── Rendu UI ──────────────────────────────────────────────────────────────────

/** Met à jour toute la section "EQ par appareil" dans #set-page-audio. */
export function renderDeviceProfiles() {
  // Label de l'appareil actuel
  const labelEl = document.getElementById('eq-device-current-label');
  if (labelEl) labelEl.textContent = getActiveDeviceLabel();

  // Bouton Enregistrer — toujours actif (on peut enregistrer pour le device courant)
  const saveBtn = document.getElementById('eq-device-save-btn');
  if (saveBtn) saveBtn.disabled = false;

  // Liste des profils enregistrés
  const list = document.getElementById('eq-device-profiles-list');
  if (!list) return;

  const ids = Object.keys(_deviceProfiles);
  if (ids.length === 0) {
    list.innerHTML = '<div class="eq-device-empty">Aucun profil enregistré</div>';
    return;
  }

  list.innerHTML = ids.map(id => {
    const p        = _deviceProfiles[id];
    const label    = esc(p.label || id);
    const isActive = id === (_activeId || 'default');
    const gains    = p.bands.map(v => Math.round(v));
    const preview  = gains.map(v => {
      const h   = Math.round(Math.abs(v) / 12 * 8);
      const cls = v > 0 ? 'eq-bar-boost' : v < 0 ? 'eq-bar-cut' : 'eq-bar-flat';
      return `<span class="${cls}" style="height:${h}px"></span>`;
    }).join('');
    return `<div class="eq-device-entry${isActive ? ' active' : ''}">
      <div class="eq-device-entry-info">
        <span class="eq-device-name">${label}</span>
        <span class="eq-device-bars" aria-hidden="true">${preview}</span>
      </div>
      <button class="mbtn eq-device-del-btn"
        data-action="delete-device-eq"
        data-device-id="${esc(id)}"
        aria-label="Supprimer le profil ${label}"
        style="font-size:10px;padding:3px 8px">✕</button>
    </div>`;
  }).join('');
}

// ── Détection device ──────────────────────────────────────────────────────────

async function _refreshActiveDevice() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter(d => d.kind === 'audiooutput');
    _knownIds = outputs.map(d => d.deviceId);

    // L'élément <audio> expose sinkId ('' = sortie par défaut OS)
    const audioEl = document.getElementById('audio');
    const sinkId  = audioEl?.sinkId ?? '';
    _activeId     = sinkId;

    // Trouver le label correspondant
    const match  = outputs.find(d => d.deviceId === (sinkId || 'default')) || outputs[0];
    _activeLabel = match?.label || '';
  } catch (e) {
    console.warn('[eqdevice] enumerateDevices failed:', e);
  }
}

async function _onDeviceChange() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    // B21 FIX : devicechange fire pour TOUT changement de périphérique média
    // (brancher un micro/webcam). Ne ré-appliquer l'EQ que si le périphérique de
    // SORTIE a réellement changé — sinon rampes setTargetAtTime inutiles.
    const _prevActiveId = _activeId;
    await _refreshActiveDevice();

    // Auto-appliquer le profil enregistré uniquement si la sortie a changé
    if (_activeId !== _prevActiveId) {
      const profileKey = _activeId || 'default';
      if (_deviceProfiles[profileKey]) {
        applyEQGains(_deviceProfiles[profileKey].bands);
      }
    }

    // Mettre à jour l'UI si settings est ouvert
    renderDeviceProfiles();
  } catch (e) {
    console.warn('[eqdevice] devicechange handler error:', e);
  }
}
