// Firebase SDK (App, Analytics, Authentication & Cloud Firestore ONLY)
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getAnalytics, isSupported as isAnalyticsSupported } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-analytics.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInAnonymously,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore,
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  addDoc,
  deleteDoc,
  query,
  where,
  onSnapshot,
  increment
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

// Chargement de la configuration depuis le serveur (/api/config alimenté par .env)
// Aucune clé, mot de passe ou webhook Discord n'est écrit en dur dans ce fichier open-source.
const runtimeConfigRes = await fetch('/api/config');
const runtimeConfig = await runtimeConfigRes.json();

const app = initializeApp(runtimeConfig.firebaseConfig);
isAnalyticsSupported().then((yes) => {
  if (yes) getAnalytics(app);
}).catch(() => {});

const auth = getAuth(app);
const db = getFirestore(app);

const QR_DISPLAY_DOMAIN = runtimeConfig.publicDomain || 'wordcloud.sroff.dev';
const QR_BASE_DOMAIN = `https://${QR_DISPLAY_DOMAIN}`;
const LOGO_URL = runtimeConfig.logoUrl || '';
const ALLOWED_USERNAMES = new Set((runtimeConfig.allowedUsernames || []).map(u => u.toLowerCase()));
const LOBBY_EXPIRY_MS = 10 * 60 * 1000;

const WORD_PALETTE = [
  '#0f172a',
  '#2563eb',
  '#0284c7',
  '#4f46e5',
  '#0d9488',
  '#334155',
  '#1d4ed8',
  '#0369a1'
];

function formatDefaultRoomName(date = new Date()) {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yy = String(date.getFullYear()).slice(-2);
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${dd}-${mm}-${yy}_${hh}-${min}`;
}

const measureCanvas = document.createElement('canvas');
const measureCtx = measureCanvas.getContext('2d');

function measureWordDimensions(text, fontSize) {
  measureCtx.font = `700 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const metrics = measureCtx.measureText(text);
  const w = Math.ceil(metrics.width) + 16;
  const h = Math.ceil(fontSize * 1.18) + 8;
  return { w, h };
}

const clientId = (() => {
  try {
    let id = sessionStorage.getItem('wc_client_id');
    if (!id) {
      id = 'p_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
      sessionStorage.setItem('wc_client_id', id);
    }
    return id;
  } catch (e) {
    return 'p_' + Math.random().toString(36).slice(2, 10);
  }
})();

const state = {
  username: null,
  firebaseUid: null,
  currentCode: null,
  isCreator: false,
  room: null,
  wordsList: [],
  imagesList: [],
  participantCount: 0,
  unsubRoom: null,
  unsubWords: null,
  unsubImages: null,
  unsubParticipants: null,
  presenceDocRef: null,
  countdownInterval: null,
  pendingImageData: null,
  placedItems: []
};

// Views
const homeView = document.getElementById('home-view');
const adminLobbyView = document.getElementById('admin-lobby-view');
const adminLiveView = document.getElementById('admin-live-view');
const participantView = document.getElementById('participant-view');

// Home Topbar & Modals
const openLoginModalBtn = document.getElementById('open-login-modal-btn');
const loggedInControls = document.getElementById('logged-in-controls');
const loggedUserPill = document.getElementById('logged-user-pill');
const openHistoryModalBtn = document.getElementById('open-history-modal-btn');
const openCreateModalBtn = document.getElementById('open-create-modal-btn');
const logoutBtn = document.getElementById('logout-btn');

const loginModal = document.getElementById('login-modal');
const closeLoginModal = document.getElementById('close-login-modal');
const loginForm = document.getElementById('login-form');
const loginUsernameInput = document.getElementById('login-username');
const loginPasswordInput = document.getElementById('login-password');
const loginSubmitBtn = document.getElementById('login-submit-btn');

// Modal Paramètres du compte
const changePasswordModal = document.getElementById('change-password-modal');
const closePasswordModal = document.getElementById('close-password-modal');
const cancelPasswordBtn = document.getElementById('cancel-password-btn');
const tabAccountPwd = document.getElementById('tab-account-pwd');
const tabAccountWebhook = document.getElementById('tab-account-webhook');
const changePasswordForm = document.getElementById('change-password-form');
const passwordModalUsername = document.getElementById('password-modal-username');
const newPasswordInput = document.getElementById('new-password-input');
const confirmPasswordInput = document.getElementById('confirm-password-input');
const savePasswordBtn = document.getElementById('save-password-btn');

const changeWebhookForm = document.getElementById('change-webhook-form');
const customWebhookInput = document.getElementById('custom-webhook-input');
const resetWebhookBtn = document.getElementById('reset-webhook-btn');
const saveWebhookBtn = document.getElementById('save-webhook-btn');

const createModal = document.getElementById('create-modal');
const closeCreateModal = document.getElementById('close-create-modal');
const createRoomForm = document.getElementById('create-room-form');
const roomNameInput = document.getElementById('room-name-input');
const createRoomBtn = document.getElementById('create-room-btn');
const durationInput = document.getElementById('duration-input');
const presetChips = document.querySelectorAll('.preset-chip');

const historyModal = document.getElementById('history-modal');
const closeHistoryModal = document.getElementById('close-history-modal');
const historyListEl = document.getElementById('history-list');

// Popups Renommer et Supprimer
const renameRoomModal = document.getElementById('rename-room-modal');
const closeRenameModal = document.getElementById('close-rename-modal');
const cancelRenameBtn = document.getElementById('cancel-rename-btn');
const renameRoomForm = document.getElementById('rename-room-form');
const renameRoomCodeLabel = document.getElementById('rename-room-code-label');
const renameRoomInput = document.getElementById('rename-room-input');
const confirmRenameBtn = document.getElementById('confirm-rename-btn');

const deleteRoomModal = document.getElementById('delete-room-modal');
const closeDeleteModal = document.getElementById('close-delete-modal');
const cancelDeleteBtn = document.getElementById('cancel-delete-btn');
const deleteRoomNameLabel = document.getElementById('delete-room-name-label');
const confirmDeleteBtn = document.getElementById('confirm-delete-btn');

let activeRenameTarget = null;
let activeDeleteTarget = null;

const joinRoomForm = document.getElementById('join-room-form');
const joinCodeInput = document.getElementById('join-code-input');

// Admin Lobby DOM
const lobbyBackBtn = document.getElementById('lobby-back-btn');
const lobbyRoomName = document.getElementById('lobby-room-name');
const lobbyQrBox = document.getElementById('lobby-qr-box');
const lobbyUrlText = document.getElementById('lobby-url-text');
const lobbyCodeText = document.getElementById('lobby-code-text');
const lobbyParticipantCount = document.getElementById('lobby-participant-count');
const lobbyDurationLabel = document.getElementById('lobby-duration-label');
const sendDiscordBtn = document.getElementById('send-discord-btn');
const startSessionBtn = document.getElementById('start-session-btn');

// Admin Live DOM
const liveBackBtn = document.getElementById('live-back-btn');
const liveRoomName = document.getElementById('live-room-name');
const liveParticipantCount = document.getElementById('live-participant-count');
const liveTopCode = document.getElementById('live-top-code');
const showQrOverlayBtn = document.getElementById('show-qr-overlay-btn');
const toggleImagesBtn = document.getElementById('toggle-images-btn');
const toggleImagesText = document.getElementById('toggle-images-text');
const liveTimerBox = document.getElementById('live-timer-box');
const liveTimerText = document.getElementById('live-timer-text');
const endTimerNowBtn = document.getElementById('end-timer-now-btn');
const exportPngBtn = document.getElementById('export-png-btn');
const exportPdfBtn = document.getElementById('export-pdf-btn');

const cloudStage = document.getElementById('cloud-stage');
const cloudEmptyState = document.getElementById('cloud-empty-state');
const cloudCanvas = document.getElementById('cloud-canvas');
const liveStatsText = document.getElementById('live-stats-text');
const liveImagesNotice = document.getElementById('live-images-notice');

// Participant DOM
const partRoomCode = document.getElementById('part-room-code');
const partTimerBadge = document.getElementById('part-timer-badge');
const partWaitingState = document.getElementById('part-waiting-state');
const partActiveState = document.getElementById('part-active-state');
const partEndedState = document.getElementById('part-ended-state');
const participantSubmitForm = document.getElementById('participant-submit-form');
const partWordInput = document.getElementById('part-word-input');
const partImageInput = document.getElementById('part-image-input');
const partUploadPlaceholder = document.getElementById('part-upload-placeholder');
const partImagePreview = document.getElementById('part-image-preview');
const partPreviewImg = document.getElementById('part-preview-img');
const partRemoveImgBtn = document.getElementById('part-remove-img-btn');
const partSendBtn = document.getElementById('part-send-btn');

// QR Modal
const qrModal = document.getElementById('qr-modal');
const closeQrModal = document.getElementById('close-qr-modal');
const modalCode = document.getElementById('modal-code');
const modalQrContainer = document.getElementById('modal-qr-container');
const modalUrl = document.getElementById('modal-url');

// Feedback Modal
const openFeedbackModalBtn = document.getElementById('open-feedback-modal-btn');
const feedbackModal = document.getElementById('feedback-modal');
const closeFeedbackModal = document.getElementById('close-feedback-modal');
const feedbackForm = document.getElementById('feedback-form');
const categoryChips = document.querySelectorAll('.category-chip');
const feedbackAuthorInput = document.getElementById('feedback-author-input');
const feedbackMessageInput = document.getElementById('feedback-message-input');
const feedbackSubmitBtn = document.getElementById('feedback-submit-btn');
let selectedFeedbackCategory = 'bug';

const toastContainer = document.getElementById('toast-container');

function showToast(message, isError = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (isError ? ' error' : '');
  el.textContent = message;
  toastContainer.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function switchActiveView(targetView) {
  [homeView, adminLobbyView, adminLiveView, participantView].forEach(v => {
    v.classList.toggle('active', v === targetView);
  });
}

// ==================== AUTHENTIFICATION & SESSION SÉCURISÉE ====================
function getLoggedAccountFromStorage() {
  try {
    const saved = localStorage.getItem('wc_logged_user');
    if (saved && ALLOWED_USERNAMES.has(saved)) {
      return saved;
    }
  } catch (e) {}
  return null;
}

state.username = getLoggedAccountFromStorage();

function updateAuthUI() {
  const isLogged = Boolean(state.username && ALLOWED_USERNAMES.has(state.username));
  openLoginModalBtn.classList.toggle('hidden', isLogged);
  loggedInControls.classList.toggle('hidden', !isLogged);
  if (isLogged) {
    loggedUserPill.textContent = state.username;
  }
}

openLoginModalBtn.addEventListener('click', () => {
  loginModal.classList.remove('hidden');
  loginUsernameInput.focus();
});
closeLoginModal.addEventListener('click', () => loginModal.classList.add('hidden'));
loginModal.addEventListener('click', (e) => {
  if (e.target === loginModal) loginModal.classList.add('hidden');
});

openCreateModalBtn.addEventListener('click', () => {
  if (!state.username) return;
  roomNameInput.value = '';
  roomNameInput.placeholder = `Par défaut : ${formatDefaultRoomName()}`;
  createModal.classList.remove('hidden');
  roomNameInput.focus();
});
closeCreateModal.addEventListener('click', () => createModal.classList.add('hidden'));
createModal.addEventListener('click', (e) => {
  if (e.target === createModal) createModal.classList.add('hidden');
});

openHistoryModalBtn.addEventListener('click', () => {
  if (!state.username) return;
  historyModal.classList.remove('hidden');
  loadAccountHistory();
});
closeHistoryModal.addEventListener('click', () => historyModal.classList.add('hidden'));
historyModal.addEventListener('click', (e) => {
  if (e.target === historyModal) historyModal.classList.add('hidden');
});

onAuthStateChanged(auth, (user) => {
  if (user && user.email) {
    const prefix = user.email.split('@')[0].toLowerCase();
    if (ALLOWED_USERNAMES.has(prefix)) {
      state.username = prefix;
      state.firebaseUid = user.uid;
      localStorage.setItem('wc_logged_user', prefix);
      updateAuthUI();
      return;
    }
  }
  state.username = getLoggedAccountFromStorage();
  updateAuthUI();
});

async function ensureFirebaseAuthSession() {
  if (auth.currentUser) return auth.currentUser;
  try {
    const anon = await signInAnonymously(auth);
    return anon.user;
  } catch (e) {
    return null;
  }
}

// Vérifie si un mot de passe personnalisé a été défini dans Firestore pour ce compte
async function getCustomFirestorePassword(username) {
  try {
    await ensureFirebaseAuthSession();
    const accSnap = await getDoc(doc(db, 'accounts', username));
    if (accSnap.exists() && typeof accSnap.data().password === 'string' && accSnap.data().password.length > 0) {
      return accSnap.data().password;
    }
  } catch (e) {}
  try {
    const localCustom = localStorage.getItem(`wc_custom_pwd_${username}`);
    if (localCustom) return localCustom;
  } catch (e) {}
  return null;
}

// Récupère le webhook Discord personnalisé du compte (ou '' pour laisser le serveur utiliser le webhook .env par défaut)
async function getAccountCustomInviteWebhook(username) {
  if (!username) return '';
  try {
    await ensureFirebaseAuthSession();
    const accSnap = await getDoc(doc(db, 'accounts', username));
    if (accSnap.exists()) {
      const customUrl = accSnap.data().inviteWebhookUrl;
      if (typeof customUrl === 'string' && customUrl.startsWith('https://discord.com/api/webhooks/')) {
        return customUrl;
      }
    }
  } catch (e) {}
  try {
    const localWebhook = localStorage.getItem(`wc_custom_webhook_${username}`);
    if (localWebhook && localWebhook.startsWith('https://discord.com/api/webhooks/')) {
      return localWebhook;
    }
  } catch (e) {}
  return '';
}

function switchAccountTab(tabName) {
  const isPwd = tabName === 'pwd';
  tabAccountPwd.classList.toggle('active', isPwd);
  tabAccountWebhook.classList.toggle('active', !isPwd);
  changePasswordForm.classList.toggle('hidden', !isPwd);
  changeWebhookForm.classList.toggle('hidden', isPwd);
}

tabAccountPwd.addEventListener('click', () => switchAccountTab('pwd'));
tabAccountWebhook.addEventListener('click', () => switchAccountTab('webhook'));

async function openChangePasswordPopup() {
  if (!state.username) return;
  passwordModalUsername.textContent = state.username;
  newPasswordInput.value = '';
  confirmPasswordInput.value = '';
  switchAccountTab('pwd');
  changePasswordModal.classList.remove('hidden');

  const currentCustomWebhook = await getAccountCustomInviteWebhook(state.username);
  customWebhookInput.value = currentCustomWebhook;
}

function closeChangePasswordPopup() {
  changePasswordModal.classList.add('hidden');
}

loggedUserPill.addEventListener('click', openChangePasswordPopup);
closePasswordModal.addEventListener('click', closeChangePasswordPopup);
cancelPasswordBtn.addEventListener('click', closeChangePasswordPopup);
changePasswordModal.addEventListener('click', (e) => {
  if (e.target === changePasswordModal) closeChangePasswordPopup();
});

changePasswordForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.username || !ALLOWED_USERNAMES.has(state.username)) return;

  const newPass = newPasswordInput.value;
  const confirmPass = confirmPasswordInput.value;

  if (!newPass) {
    showToast('Veuillez saisir un nouveau mot de passe.', true);
    return;
  }
  if (newPass !== confirmPass) {
    showToast('Les deux mots de passe ne correspondent pas.', true);
    return;
  }

  savePasswordBtn.disabled = true;
  try {
    try {
      localStorage.setItem(`wc_custom_pwd_${state.username}`, newPass);
    } catch (e) {}
    await ensureFirebaseAuthSession();
    await setDoc(doc(db, 'accounts', state.username), {
      username: state.username,
      password: newPass,
      updatedAt: Date.now()
    }, { merge: true });
    closeChangePasswordPopup();
    showToast('Votre mot de passe a été modifié avec succès.');
  } catch (err) {
    closeChangePasswordPopup();
    showToast('Mot de passe mis à jour.');
  } finally {
    savePasswordBtn.disabled = false;
  }
});

changeWebhookForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.username || !ALLOWED_USERNAMES.has(state.username)) return;

  const rawUrl = customWebhookInput.value.trim();
  if (rawUrl && !/^https:\/\/(ptb\.|canary\.)?discord(app)?\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+/.test(rawUrl)) {
    showToast('Veuillez entrer une URL de Webhook Discord valide.', true);
    return;
  }

  saveWebhookBtn.disabled = true;
  try {
    try {
      if (rawUrl) {
        localStorage.setItem(`wc_custom_webhook_${state.username}`, rawUrl);
      } else {
        localStorage.removeItem(`wc_custom_webhook_${state.username}`);
      }
    } catch (e) {}
    await ensureFirebaseAuthSession();
    await setDoc(doc(db, 'accounts', state.username), {
      username: state.username,
      inviteWebhookUrl: rawUrl,
      updatedAt: Date.now()
    }, { merge: true });
    closeChangePasswordPopup();
    showToast(rawUrl ? 'Webhook Discord du compte mis à jour !' : 'Webhook Discord remis par défaut.');
  } catch (err) {
    closeChangePasswordPopup();
    showToast('Webhook Discord mis à jour.');
  } finally {
    saveWebhookBtn.disabled = false;
  }
});

resetWebhookBtn.addEventListener('click', async () => {
  customWebhookInput.value = '';
  if (!state.username) return;
  try {
    localStorage.removeItem(`wc_custom_webhook_${state.username}`);
    await ensureFirebaseAuthSession();
    await setDoc(doc(db, 'accounts', state.username), {
      username: state.username,
      inviteWebhookUrl: '',
      updatedAt: Date.now()
    }, { merge: true });
  } catch (e) {}
  showToast('Webhook remis par défaut.');
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsernameInput.value.trim().toLowerCase();
  const password = loginPasswordInput.value;

  if (!ALLOWED_USERNAMES.has(username)) {
    showToast('Identifiant ou mot de passe incorrect.', true);
    return;
  }

  loginSubmitBtn.disabled = true;
  try {
    const customPwd = await getCustomFirestorePassword(username);
    let hasCustomFirestorePassword = false;
    if (customPwd !== null) {
      if (password !== customPwd) {
        showToast('Identifiant ou mot de passe incorrect.', true);
        return;
      }
      hasCustomFirestorePassword = true;
    }

    // Vérification via le serveur (/api/auth/verify lit .env sans jamais exposer les mots de passe au client)
    const verifyRes = await fetch('/api/auth/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, hasCustomFirestorePassword })
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) {
      showToast(verifyData.error || 'Identifiant ou mot de passe incorrect.', true);
      return;
    }

    try {
      const cred = await signInWithEmailAndPassword(auth, verifyData.firebaseEmail, verifyData.firebasePass);
      state.firebaseUid = cred.user.uid;
    } catch (firebaseErr) {
      try {
        const cred = await createUserWithEmailAndPassword(auth, verifyData.firebaseEmail, verifyData.firebasePass);
        state.firebaseUid = cred.user.uid;
      } catch (createErr) {
        try {
          const anon = await signInAnonymously(auth);
          state.firebaseUid = anon.user.uid;
        } catch (anonErr) {
          state.firebaseUid = `local_${username}`;
        }
      }
    }

    state.username = username;
    localStorage.setItem('wc_logged_user', username);
    loginPasswordInput.value = '';
    loginModal.classList.add('hidden');
    updateAuthUI();
    showToast(`Connecté (${username})`);
  } finally {
    loginSubmitBtn.disabled = false;
  }
});

logoutBtn.addEventListener('click', async () => {
  localStorage.removeItem('wc_logged_user');
  state.username = null;
  state.firebaseUid = null;
  createModal.classList.add('hidden');
  historyModal.classList.add('hidden');
  try {
    await signOut(auth);
  } catch (e) {}
  updateAuthUI();
  if (state.isCreator) {
    await leaveToHome();
  }
  showToast('Déconnecté.');
});

// ==================== SUPPRESSION & EXPIRATION DES ROOMS ====================
async function deleteEntireRoomFromFirestore(code) {
  if (!code) return;
  const upper = code.toUpperCase();
  try {
    for (const sub of ['words', 'images', 'participants']) {
      const subSnap = await getDocs(collection(db, 'rooms', upper, sub));
      const deletions = [];
      subSnap.forEach(subDoc => deletions.push(deleteDoc(subDoc.ref)));
      await Promise.all(deletions);
    }
    await deleteDoc(doc(db, 'rooms', upper));
  } catch (e) {}
}

function isLobbyExpired(roomData) {
  if (!roomData || roomData.status !== 'lobby') return false;
  const now = Date.now();
  if (roomData.lobbyExpiresAt && now >= roomData.lobbyExpiresAt) return true;
  if (roomData.createdAt && now - roomData.createdAt >= LOBBY_EXPIRY_MS) return true;
  return false;
}

// ==================== HISTORIQUE DES ROOMS DU COMPTE ====================
async function loadAccountHistory() {
  if (!state.username) return;
  historyListEl.innerHTML = '<p class="history-empty">Chargement de vos rooms...</p>';

  try {
    await ensureFirebaseAuthSession();
    const roomsCol = collection(db, 'rooms');
    const q = query(roomsCol, where('owner', '==', state.username));
    const snap = await getDocs(q);

    const rooms = [];
    const expiredDeletions = [];
    snap.forEach(d => {
      const data = d.data();
      if (isLobbyExpired(data)) {
        expiredDeletions.push(deleteEntireRoomFromFirestore(d.id));
      } else if (data.status !== 'lobby') {
        rooms.push({ id: d.id, ...data });
      }
    });
    if (expiredDeletions.length > 0) {
      Promise.all(expiredDeletions).catch(() => {});
    }
    rooms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

    if (rooms.length === 0) {
      historyListEl.innerHTML = '<p class="history-empty">Aucune room créée avec ce compte pour le moment.</p>';
      return;
    }

    historyListEl.innerHTML = '';
    rooms.forEach((r) => {
      const item = document.createElement('div');
      item.className = 'history-item';

      const main = document.createElement('div');
      main.className = 'history-item-main';

      const titleEl = document.createElement('div');
      titleEl.className = 'history-room-title';
      titleEl.textContent = r.name || r.code;

      const meta = document.createElement('div');
      meta.className = 'history-meta';

      const codeTag = document.createElement('span');
      codeTag.className = 'history-code-tag';
      codeTag.textContent = r.code;

      const statusLabel = document.createElement('span');
      const isEnded = r.status === 'ended' || (r.status === 'active' && r.endTime && Date.now() >= r.endTime);
      statusLabel.textContent = isEnded ? 'Terminée (Export disponible)' : r.status === 'active' ? 'En cours' : 'Salle d’attente';

      meta.appendChild(codeTag);
      meta.appendChild(statusLabel);

      main.appendChild(titleEl);
      main.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'history-actions';

      const viewBtn = document.createElement('button');
      viewBtn.type = 'button';
      viewBtn.className = 'btn btn-primary btn-icon-action';
      viewBtn.title = isEnded ? 'Revoir et exporter ce nuage' : 'Ouvrir la session';
      viewBtn.innerHTML = `
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke-linecap="round" stroke-linejoin="round"/>
          <circle cx="12" cy="12" r="3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      viewBtn.addEventListener('click', async () => {
        historyModal.classList.add('hidden');
        await enterRoom(r.code, true, false);
      });

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'btn btn-outline btn-icon-action';
      renameBtn.title = 'Renommer';
      renameBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <path d="M12 20h9" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      renameBtn.addEventListener('click', () => {
        openRenamePopup(r, titleEl);
      });

      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'btn btn-danger-outline btn-icon-action';
      deleteBtn.title = 'Supprimer';
      deleteBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
          <polyline points="3 6 5 6 21 6" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="10" y1="11" x2="10" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
          <line x1="14" y1="11" x2="14" y2="17" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      `;
      deleteBtn.addEventListener('click', () => {
        openDeletePopup(r, item, titleEl);
      });

      actions.appendChild(viewBtn);
      actions.appendChild(renameBtn);
      actions.appendChild(deleteBtn);
      item.appendChild(main);
      item.appendChild(actions);
      historyListEl.appendChild(item);
    });
  } catch (err) {
    historyListEl.innerHTML = `<p class="history-empty">Impossible de charger l'historique (${err.message}).</p>`;
  }
}

function openRenamePopup(roomObj, titleEl) {
  activeRenameTarget = { roomObj, titleEl };
  renameRoomCodeLabel.textContent = roomObj.code;
  renameRoomInput.value = titleEl.textContent || roomObj.name || roomObj.code;
  renameRoomModal.classList.remove('hidden');
  renameRoomInput.focus();
  renameRoomInput.select();
}

function closeRenamePopup() {
  renameRoomModal.classList.add('hidden');
  activeRenameTarget = null;
}

closeRenameModal.addEventListener('click', closeRenamePopup);
cancelRenameBtn.addEventListener('click', closeRenamePopup);
renameRoomModal.addEventListener('click', (e) => {
  if (e.target === renameRoomModal) closeRenamePopup();
});

renameRoomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeRenameTarget) return;
  const { roomObj, titleEl } = activeRenameTarget;
  const newName = renameRoomInput.value.trim() || formatDefaultRoomName(new Date(roomObj.createdAt || Date.now()));

  confirmRenameBtn.disabled = true;
  try {
    await updateDoc(doc(db, 'rooms', roomObj.code), { name: newName });
    roomObj.name = newName;
    titleEl.textContent = newName;
    if (state.currentCode === roomObj.code && state.room) {
      state.room.name = newName;
      lobbyRoomName.textContent = newName;
      liveRoomName.textContent = newName;
    }
    closeRenamePopup();
    showToast('Room renommée.');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  } finally {
    confirmRenameBtn.disabled = false;
  }
});

function openDeletePopup(roomObj, itemEl, titleEl) {
  activeDeleteTarget = { roomObj, itemEl };
  deleteRoomNameLabel.textContent = `${titleEl.textContent || roomObj.name || roomObj.code} (${roomObj.code})`;
  deleteRoomModal.classList.remove('hidden');
}

function closeDeletePopup() {
  deleteRoomModal.classList.add('hidden');
  activeDeleteTarget = null;
}

closeDeleteModal.addEventListener('click', closeDeletePopup);
cancelDeleteBtn.addEventListener('click', closeDeletePopup);
deleteRoomModal.addEventListener('click', (e) => {
  if (e.target === deleteRoomModal) closeDeletePopup();
});

confirmDeleteBtn.addEventListener('click', async () => {
  if (!activeDeleteTarget) return;
  const { roomObj, itemEl } = activeDeleteTarget;

  confirmDeleteBtn.disabled = true;
  try {
    await deleteEntireRoomFromFirestore(roomObj.code);
    itemEl.remove();
    if (historyListEl.children.length === 0) {
      historyListEl.innerHTML = '<p class="history-empty">Aucune room créée avec ce compte pour le moment.</p>';
    }
    closeDeletePopup();
    showToast(`Nuage de mots ${roomObj.name || roomObj.code} supprimé.`);
  } catch (err) {
    showToast('Erreur lors de la suppression : ' + err.message, true);
  } finally {
    confirmDeleteBtn.disabled = false;
  }
});

// ==================== CRÉATION ET CONNEXION AUX ROOMS ====================
async function generateUniqueFirestoreCode() {
  await ensureFirebaseAuthSession();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  for (let attempt = 0; attempt < 15; attempt++) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += letters.charAt(Math.floor(Math.random() * letters.length));
    }
    const roomRef = doc(db, 'rooms', code);
    const snap = await getDoc(roomRef);
    if (!snap.exists()) {
      return code;
    }
  }
  throw new Error('Impossible de générer un code unique, veuillez réessayer.');
}

presetChips.forEach(chip => {
  chip.addEventListener('click', () => {
    presetChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    durationInput.value = chip.dataset.min;
  });
});

durationInput.addEventListener('input', () => {
  presetChips.forEach(c => {
    c.classList.toggle('active', c.dataset.min === durationInput.value);
  });
});

joinCodeInput.addEventListener('input', () => {
  joinCodeInput.value = joinCodeInput.value.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 6);
});

createRoomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.username || !ALLOWED_USERNAMES.has(state.username)) {
    showToast('Connectez-vous pour créer une room.', true);
    updateAuthUI();
    return;
  }

  const customName = roomNameInput.value.trim();
  const roomName = customName || formatDefaultRoomName(new Date());

  const durationMinutes = Math.max(1, Math.min(120, Number(durationInput.value) || 5));
  const durationSeconds = Math.round(durationMinutes * 60);

  createRoomBtn.disabled = true;
  try {
    const code = await generateUniqueFirestoreCode();
    const roomRef = doc(db, 'rooms', code);

    const now = Date.now();
    const roomData = {
      code,
      name: roomName,
      owner: state.username,
      ownerUid: state.firebaseUid || `local_${state.username}`,
      status: 'lobby',
      durationSeconds,
      showImages: false,
      createdAt: now,
      lobbyExpiresAt: now + LOBBY_EXPIRY_MS,
      startedAt: null,
      endTime: null
    };

    await setDoc(roomRef, roomData);
    createModal.classList.add('hidden');
    await enterRoom(code, true, false);
  } catch (err) {
    showToast('Erreur Firestore : ' + (err.message || 'Impossible de créer la room.'), true);
  } finally {
    createRoomBtn.disabled = false;
  }
});

joinRoomForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const code = joinCodeInput.value.trim().toUpperCase();
  if (!/^[A-Z]{6}$/.test(code)) {
    showToast('Veuillez saisir un code valide à 6 lettres.', true);
    return;
  }
  await enterRoom(code, true, true);
});

async function cleanupSubscriptions() {
  if (state.unsubRoom) { state.unsubRoom(); state.unsubRoom = null; }
  if (state.unsubWords) { state.unsubWords(); state.unsubWords = null; }
  if (state.unsubImages) { state.unsubImages(); state.unsubImages = null; }
  if (state.unsubParticipants) { state.unsubParticipants(); state.unsubParticipants = null; }
  if (state.countdownInterval) {
    clearInterval(state.countdownInterval);
    state.countdownInterval = null;
  }
  if (state.presenceDocRef) {
    const refToDelete = state.presenceDocRef;
    state.presenceDocRef = null;
    try { await deleteDoc(refToDelete); } catch (e) {}
  }
}

window.addEventListener('beforeunload', () => {
  if (state.presenceDocRef) {
    deleteDoc(state.presenceDocRef).catch(() => {});
  }
});

async function leaveToHome() {
  await cleanupSubscriptions();
  state.currentCode = null;
  state.room = null;
  window.history.pushState({}, '', '/');
  switchActiveView(homeView);
}

async function quitFromLobbyAndDestroyRoom() {
  const codeToDelete = state.currentCode;
  const isStillLobby = state.isCreator && state.room && state.room.status === 'lobby';
  await cleanupSubscriptions();
  state.currentCode = null;
  state.room = null;
  window.history.pushState({}, '', '/');
  switchActiveView(homeView);

  if (isStillLobby && codeToDelete) {
    await deleteEntireRoomFromFirestore(codeToDelete);
    showToast('Session annulée et room supprimée.');
  }
}

lobbyBackBtn.addEventListener('click', quitFromLobbyAndDestroyRoom);
liveBackBtn.addEventListener('click', leaveToHome);

window.addEventListener('popstate', () => {
  handleInitialRoute();
});

async function enterRoom(code, pushHistory = false, isJoinRoute = false) {
  await cleanupSubscriptions();
  await ensureFirebaseAuthSession();
  const upperCode = code.toUpperCase();
  const roomRef = doc(db, 'rooms', upperCode);

  try {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) {
      showToast('Aucune room ne correspond à ce code.', true);
      window.history.replaceState({}, '', '/');
      switchActiveView(homeView);
      return;
    }

    const roomData = snap.data();

    if (isLobbyExpired(roomData)) {
      await deleteEntireRoomFromFirestore(upperCode);
      showToast('Cette room a expiré (10 minutes écoulées sans lancement). Veuillez en créer une nouvelle.', true);
      window.history.replaceState({}, '', '/');
      switchActiveView(homeView);
      return;
    }

    if (!isJoinRoute) {
      const currentLoggedUser = getLoggedAccountFromStorage();
      if (!currentLoggedUser || roomData.owner !== currentLoggedUser) {
        showToast('Accès refusé : seul le compte créateur de cette room peut accéder à cette page.', true);
        window.history.replaceState({}, '', '/');
        switchActiveView(homeView);
        return;
      }
      state.isCreator = true;
    } else {
      state.isCreator = false;
    }

    if (pushHistory) {
      const targetPath = isJoinRoute ? `/join/${upperCode}` : `/${upperCode}`;
      window.history.pushState({}, '', targetPath);
    }

    state.currentCode = upperCode;
    state.wordsList = [];
    state.imagesList = [];

    if (state.isCreator) {
      prepareAdminQRCode(upperCode, roomData.name || upperCode);

      const wordsCol = collection(db, 'rooms', upperCode, 'words');
      state.unsubWords = onSnapshot(wordsCol, (qSnap) => {
        const list = [];
        qSnap.forEach(d => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (b.count || 1) - (a.count || 1));
        state.wordsList = list;
        if (state.room && state.room.status !== 'lobby') {
          renderCloud();
        }
      });

      const imagesCol = collection(db, 'rooms', upperCode, 'images');
      state.unsubImages = onSnapshot(imagesCol, (qSnap) => {
        const list = [];
        qSnap.forEach(d => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        state.imagesList = list;
        if (state.room && state.room.status !== 'lobby') {
          renderCloud();
        }
      });

      const partCol = collection(db, 'rooms', upperCode, 'participants');
      state.unsubParticipants = onSnapshot(partCol, (qSnap) => {
        state.participantCount = qSnap.size;
        lobbyParticipantCount.textContent = String(state.participantCount);
        liveParticipantCount.textContent = String(state.participantCount);
      });
    } else {
      const pRef = doc(db, 'rooms', upperCode, 'participants', clientId);
      state.presenceDocRef = pRef;
      setDoc(pRef, { joinedAt: Date.now() }).catch(() => {});
    }

    state.unsubRoom = onSnapshot(roomRef, (docSnap) => {
      if (!docSnap.exists()) {
        showToast('La session a été fermée.', true);
        leaveToHome();
        return;
      }
      applyRoomState(docSnap.data());
    });

    startCountdownLoop();
  } catch (err) {
    showToast('Erreur de connexion Firestore : ' + err.message, true);
    window.history.replaceState({}, '', '/');
    switchActiveView(homeView);
  }
}

function prepareAdminQRCode(code, roomName) {
  const qrTargetUrl = `${QR_BASE_DOMAIN}/join/${code}`;
  const displayUrl = `${QR_DISPLAY_DOMAIN}/join/${code}`;

  lobbyRoomName.textContent = roomName || code;
  liveRoomName.textContent = roomName || code;
  lobbyCodeText.textContent = code;
  lobbyUrlText.textContent = displayUrl;
  liveTopCode.textContent = code;

  modalCode.textContent = code;
  modalUrl.textContent = displayUrl;

  const svg = window.QRCodeGenerator.toSVG(qrTargetUrl, {
    margin: 2,
    darkColor: '#0f172a',
    lightColor: '#ffffff'
  });
  lobbyQrBox.innerHTML = svg;
  modalQrContainer.innerHTML = svg;
}

function applyRoomState(room) {
  state.room = room;

  if (state.isCreator) {
    const displayName = room.name || room.code;
    lobbyRoomName.textContent = displayName;
    liveRoomName.textContent = displayName;

    if (room.status === 'lobby') {
      switchActiveView(adminLobbyView);
      const mins = Math.round((room.durationSeconds || 300) / 60);
      lobbyDurationLabel.textContent = `${mins} min`;
    } else {
      switchActiveView(adminLiveView);
      toggleImagesBtn.classList.toggle('active', Boolean(room.showImages));
      toggleImagesBtn.setAttribute('aria-pressed', String(Boolean(room.showImages)));
      toggleImagesText.textContent = room.showImages
        ? 'Images / GIFs : ON'
        : 'Images / GIFs : OFF';

      updateTimersAndButtons();
      requestAnimationFrame(() => renderCloud());
    }
  } else {
    switchActiveView(participantView);
    partRoomCode.textContent = room.code;
    updateTimersAndButtons();
  }
}

function formatMMSS(ms) {
  const totalSec = Math.max(0, Math.ceil(ms / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateTimersAndButtons() {
  if (!state.room) return;
  const room = state.room;
  const now = Date.now();

  let remainingMs = 0;
  if (room.status === 'lobby') {
    if (isLobbyExpired(room)) {
      const expiredCode = state.currentCode;
      showToast('La room a expiré après 10 minutes d’inactivité sans lancement.', true);
      leaveToHome();
      if (expiredCode) {
        deleteEntireRoomFromFirestore(expiredCode);
      }
      return;
    }
    remainingMs = (room.durationSeconds || 300) * 1000;
  } else if (room.status === 'active' && room.endTime) {
    remainingMs = Math.max(0, room.endTime - now);
    if (remainingMs === 0) {
      room.status = 'ended';
      if (state.isCreator && state.currentCode) {
        updateDoc(doc(db, 'rooms', state.currentCode), { status: 'ended' }).catch(() => {});
      }
    }
  }

  const formatted = formatMMSS(remainingMs);

  if (state.isCreator) {
    liveTimerBox.classList.remove('warning', 'expired');
    if (room.status === 'ended') {
      liveTimerBox.classList.add('expired');
      liveTimerText.textContent = '00:00';
    } else {
      if (remainingMs <= 60 * 1000) liveTimerBox.classList.add('warning');
      liveTimerText.textContent = formatted;
    }

    const isEnded = room.status === 'ended';
    endTimerNowBtn.classList.toggle('hidden', isEnded);
    exportPngBtn.disabled = !isEnded;
    exportPdfBtn.disabled = !isEnded;
  } else {
    if (room.status === 'lobby') {
      partTimerBadge.textContent = 'En attente';
      partWaitingState.classList.remove('hidden');
      partActiveState.classList.add('hidden');
      partEndedState.classList.add('hidden');
    } else if (room.status === 'active') {
      partTimerBadge.textContent = formatted;
      partWaitingState.classList.add('hidden');
      partActiveState.classList.remove('hidden');
      partEndedState.classList.add('hidden');
    } else {
      partTimerBadge.textContent = 'Terminé';
      partWaitingState.classList.add('hidden');
      partActiveState.classList.add('hidden');
      partEndedState.classList.remove('hidden');
    }
  }
}

function startCountdownLoop() {
  if (state.countdownInterval) clearInterval(state.countdownInterval);
  state.countdownInterval = setInterval(updateTimersAndButtons, 500);
}

// Envoyer l'annonce d'ouverture de la room sur Discord via le proxy serveur (/api/discord/invite)
sendDiscordBtn.addEventListener('click', async () => {
  if (!state.isCreator || !state.currentCode) return;
  const roomTitle = (state.room && state.room.name) ? state.room.name : state.currentCode;
  const durationMin = Math.round(((state.room && state.room.durationSeconds) || 300) / 60);

  sendDiscordBtn.disabled = true;
  try {
    const customWebhookUrl = await getAccountCustomInviteWebhook(state.username);
    const res = await fetch('/api/discord/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code: state.currentCode,
        roomTitle,
        durationMin,
        username: state.username,
        customWebhookUrl
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur Discord');
    showToast('Embed envoyé sur Discord !');
  } catch (err) {
    showToast('Impossible d’envoyer sur Discord : ' + err.message, true);
  } finally {
    sendDiscordBtn.disabled = false;
  }
});

startSessionBtn.addEventListener('click', async () => {
  if (!state.isCreator || !state.currentCode || !state.room) return;
  if (isLobbyExpired(state.room)) {
    const expiredCode = state.currentCode;
    showToast('Cette room a expiré (10 minutes écoulées). Veuillez en créer une nouvelle.', true);
    await leaveToHome();
    await deleteEntireRoomFromFirestore(expiredCode);
    return;
  }
  startSessionBtn.disabled = true;
  try {
    const now = Date.now();
    const durationSec = state.room.durationSeconds || 300;
    await updateDoc(doc(db, 'rooms', state.currentCode), {
      status: 'active',
      startedAt: now,
      endTime: now + durationSec * 1000
    });
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  } finally {
    startSessionBtn.disabled = false;
  }
});

toggleImagesBtn.addEventListener('click', async () => {
  if (!state.isCreator || !state.room || !state.currentCode) return;
  try {
    await updateDoc(doc(db, 'rooms', state.currentCode), {
      showImages: !state.room.showImages
    });
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
});

endTimerNowBtn.addEventListener('click', async () => {
  if (!state.isCreator || !state.room || !state.currentCode) return;
  try {
    await updateDoc(doc(db, 'rooms', state.currentCode), {
      status: 'ended',
      endTime: Date.now()
    });
    showToast('Timer terminé. Exports PNG et PDF débloqués.');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  }
});

showQrOverlayBtn.addEventListener('click', () => qrModal.classList.remove('hidden'));
closeQrModal.addEventListener('click', () => qrModal.classList.add('hidden'));
qrModal.addEventListener('click', (e) => {
  if (e.target === qrModal) qrModal.classList.add('hidden');
});

// ==================== BOUTON & MODAL "UN BUG OU UNE SUGGESTION D'AJOUT ?" (VIA PROXY SERVEUR .ENV) ====================
openFeedbackModalBtn.addEventListener('click', () => {
  if (state.username && !feedbackAuthorInput.value) {
    feedbackAuthorInput.value = state.username;
  }
  feedbackModal.classList.remove('hidden');
  feedbackMessageInput.focus();
});

closeFeedbackModal.addEventListener('click', () => feedbackModal.classList.add('hidden'));
feedbackModal.addEventListener('click', (e) => {
  if (e.target === feedbackModal) feedbackModal.classList.add('hidden');
});

categoryChips.forEach((chip) => {
  if (!chip.dataset.category) return;
  chip.addEventListener('click', () => {
    categoryChips.forEach(c => {
      if (c.dataset.category) c.classList.remove('active');
    });
    chip.classList.add('active');
    selectedFeedbackCategory = chip.dataset.category;
  });
});

feedbackForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = feedbackMessageInput.value.trim();
  const authorName = feedbackAuthorInput.value.trim() || state.username || 'Anonyme';
  if (!message) {
    showToast('Veuillez écrire un message.', true);
    return;
  }

  feedbackSubmitBtn.disabled = true;
  try {
    const res = await fetch('/api/discord/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        category: selectedFeedbackCategory,
        message,
        authorName
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur Discord');

    feedbackMessageInput.value = '';
    feedbackModal.classList.add('hidden');
    showToast('Merci ! Votre retour a été envoyé sur Discord.');
  } catch (err) {
    showToast('Impossible d’envoyer le retour : ' + err.message, true);
  } finally {
    feedbackSubmitBtn.disabled = false;
  }
});

// ==================== PARTICIPANT : ENVOI VERS FIRESTORE ====================
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Impossible de lire le fichier image.'));
    reader.onload = () => {
      const dataUrl = reader.result;
      if (file.type === 'image/gif' || dataUrl.length < 650 * 1024) {
        if (dataUrl.length > 950 * 1024) {
          reject(new Error('Ce GIF dépasse 1 Mo. Choisissez un GIF plus léger.'));
          return;
        }
        resolve(dataUrl);
        return;
      }
      const img = new Image();
      img.onload = () => {
        const maxDim = 720;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.84));
      };
      img.onerror = () => reject(new Error('Image invalide.'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

partImageInput.addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  if (!/^image\/(png|jpeg|jpg|gif|webp)$/i.test(file.type)) {
    showToast('Format non supporté (PNG, JPG, GIF, WEBP uniquement).', true);
    partImageInput.value = '';
    return;
  }
  try {
    const processedDataUrl = await processImageFile(file);
    state.pendingImageData = processedDataUrl;
    partPreviewImg.src = processedDataUrl;
    partUploadPlaceholder.classList.add('hidden');
    partImagePreview.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, true);
    partImageInput.value = '';
  }
});

function clearParticipantImage() {
  state.pendingImageData = null;
  partImageInput.value = '';
  partPreviewImg.src = '';
  partImagePreview.classList.add('hidden');
  partUploadPlaceholder.classList.remove('hidden');
}

partRemoveImgBtn.addEventListener('click', (e) => {
  e.preventDefault();
  e.stopPropagation();
  clearParticipantImage();
});

function wordToDocId(normalizedText) {
  let hash = 2166136261;
  for (let i = 0; i < normalizedText.length; i++) {
    hash ^= normalizedText.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const safeSlug = normalizedText.replace(/[^a-z0-9]/gi, '_').slice(0, 32);
  return `w_${safeSlug}_${Math.abs(hash).toString(36)}`;
}

participantSubmitForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!state.currentCode || state.isCreator) return;

  if (!state.room || state.room.status !== 'active' || (state.room.endTime && Date.now() >= state.room.endTime)) {
    showToast('Les envois sont fermés.', true);
    return;
  }

  const rawText = partWordInput.value.trim().replace(/\s+/g, ' ');
  const imageData = state.pendingImageData;

  if (!rawText && !imageData) {
    showToast('Saisissez un mot, une phrase ou ajoutez une image.', true);
    return;
  }

  partSendBtn.disabled = true;
  try {
    if (rawText) {
      const normalized = rawText.toLowerCase();
      const docId = wordToDocId(normalized);
      const wordRef = doc(db, 'rooms', state.currentCode, 'words', docId);
      const existingSnap = await getDoc(wordRef);

      if (existingSnap.exists()) {
        await updateDoc(wordRef, {
          count: increment(1),
          updatedAt: Date.now()
        });
      } else {
        const colorIdx = Math.abs(hashCode(docId)) % WORD_PALETTE.length;
        await setDoc(wordRef, {
          text: rawText,
          count: 1,
          colorIndex: colorIdx,
          updatedAt: Date.now()
        });
      }
    }

    if (imageData) {
      const imagesCol = collection(db, 'rooms', state.currentCode, 'images');
      await addDoc(imagesCol, {
        dataUrl: imageData,
        count: 1,
        createdAt: Date.now()
      });
    }

    partWordInput.value = '';
    clearParticipantImage();
    partWordInput.focus();
    showToast('Envoyé !');
  } catch (err) {
    showToast('Erreur : ' + err.message, true);
  } finally {
    partSendBtn.disabled = false;
  }
});

// ==================== NUAGE DE MOTS & PLACEMENT ANTI-COLLISION ====================
function hashCode(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

function renderCloud() {
  if (!state.isCreator || !state.room || state.room.status === 'lobby') return;

  const words = state.wordsList || [];
  const allImages = state.imagesList || [];
  const visibleImages = state.room.showImages ? allImages : [];

  const totalMentions = words.reduce((s, w) => s + (w.count || 1), 0) + allImages.length;
  liveStatsText.textContent = `${words.length} mot(s) • ${allImages.length} image(s) • ${totalMentions} envoi(s)`;
  liveImagesNotice.classList.toggle('hidden', !(allImages.length > 0 && !state.room.showImages));

  if (words.length === 0 && visibleImages.length === 0) {
    cloudEmptyState.classList.remove('hidden');
    cloudCanvas.innerHTML = '';
    state.placedItems = [];
    return;
  }

  cloudEmptyState.classList.add('hidden');

  const rect = cloudStage.getBoundingClientRect();
  const stageW = Math.max(640, rect.width || 1000);
  const stageH = Math.max(420, rect.height || 620);
  const centerX = stageW / 2;
  const centerY = stageH / 2;

  const totalItems = words.length + visibleImages.length;
  const densityFactor = Math.max(0.55, Math.min(1.1, 22 / Math.max(6, totalItems)));
  const baseFont = Math.round(22 * densityFactor);
  const maxAllowedFont = Math.round(96 * densityFactor);

  const combined = [];

  words.forEach((w) => {
    const count = w.count || 1;
    const grownSize = Math.round(baseFont + Math.pow(count - 1, 0.82) * (18 * densityFactor));
    const fontSize = Math.min(maxAllowedFont, grownSize);
    const color = WORD_PALETTE[(w.colorIndex || 0) % WORD_PALETTE.length];
    const dims = measureWordDimensions(w.text, fontSize);

    combined.push({
      type: 'word',
      id: `w_${w.id}`,
      text: w.text,
      count,
      fontSize,
      color,
      w: dims.w,
      h: dims.h,
      weight: fontSize * 1.25
    });
  });

  visibleImages.forEach((img) => {
    const count = img.count || 1;
    const size = Math.round((86 + Math.min(80, (count - 1) * 22)) * densityFactor);
    combined.push({
      type: 'image',
      id: `i_${img.id}`,
      dataUrl: img.dataUrl,
      count,
      w: size,
      h: size,
      weight: size
    });
  });

  combined.sort((a, b) => b.weight - a.weight);

  const occupied = [];
  const placed = [];

  function hasCollision(box) {
    const pad = 10;
    for (let i = 0; i < occupied.length; i++) {
      const o = occupied[i];
      if (
        box.left - pad < o.right &&
        box.right + pad > o.left &&
        box.top - pad < o.bottom &&
        box.bottom + pad > o.top
      ) {
        return true;
      }
    }
    return false;
  }

  combined.forEach((item, index) => {
    const itemW = item.w;
    const itemH = item.h;

    let angle = (hashCode(item.id) % 360) * (Math.PI / 180);
    let radius = index === 0 ? 0 : 14;
    const angleStep = 0.35;
    const radiusStep = 2.6;
    const aspect = stageW / stageH;

    let chosenX = centerX;
    let chosenY = centerY;

    for (let step = 0; step < 2200; step++) {
      const x = centerX + radius * Math.cos(angle) * Math.min(1.5, aspect);
      const y = centerY + radius * Math.sin(angle);
      const box = {
        left: x - itemW / 2,
        right: x + itemW / 2,
        top: y - itemH / 2,
        bottom: y + itemH / 2
      };

      const inside =
        box.left >= 18 &&
        box.right <= stageW - 18 &&
        box.top >= 18 &&
        box.bottom <= stageH - 18;

      if (!hasCollision(box) && (inside || step > 1100)) {
        chosenX = x;
        chosenY = y;
        occupied.push(box);
        break;
      }

      angle += angleStep;
      radius += radiusStep * (angleStep / (2 * Math.PI));
    }

    placed.push({
      ...item,
      x: chosenX,
      y: chosenY,
      stageW,
      stageH
    });
  });

  state.placedItems = placed;

  const existingNodes = new Map();
  Array.from(cloudCanvas.children).forEach(el => {
    existingNodes.set(el.dataset.itemId, el);
  });

  const activeIds = new Set();

  placed.forEach((item, idx) => {
    activeIds.add(item.id);
    let el = existingNodes.get(item.id);

    if (item.type === 'word') {
      if (!el) {
        el = document.createElement('div');
        el.className = 'cloud-word-item';
        el.dataset.itemId = item.id;
        cloudCanvas.appendChild(el);
      }
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
      el.style.fontSize = `${item.fontSize}px`;
      el.style.color = item.color;
      el.style.zIndex = String(10 + idx);
      el.textContent = item.text;
    } else {
      if (!el) {
        el = document.createElement('div');
        el.className = 'cloud-image-item';
        el.dataset.itemId = item.id;
        const img = document.createElement('img');
        img.src = item.dataUrl;
        img.alt = '';
        el.appendChild(img);
        cloudCanvas.appendChild(el);
      }
      el.style.left = `${item.x}px`;
      el.style.top = `${item.y}px`;
      el.style.width = `${item.w}px`;
      el.style.height = `${item.h}px`;
      el.style.zIndex = String(5 + idx);
    }
  });

  existingNodes.forEach((node, id) => {
    if (!activeIds.has(id)) node.remove();
  });
}

let resizeTimeout = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (state.room && state.isCreator && state.room.status !== 'lobby') {
      renderCloud();
    }
  }, 180);
});

// ==================== EXPORT PNG & PDF ====================
function loadImage(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

async function renderExportCanvas() {
  const outW = 1920;
  const outH = 1080;
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, outW, outH);

  const titleLabel = state.room && state.room.name
    ? `${state.room.name} (${state.currentCode})`
    : `Session ${state.currentCode}`;

  ctx.fillStyle = '#64748b';
  ctx.font = '600 22px Inter, -apple-system, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(`WordCloud — ${titleLabel}`, 48, 36);

  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(48, 76);
  ctx.lineTo(outW - 48, 76);
  ctx.stroke();

  const items = state.placedItems || [];
  if (items.length === 0) return canvas;

  const stageW = items[0].stageW || 1000;
  const stageH = items[0].stageH || 620;

  const targetTop = 96;
  const targetW = outW - 96;
  const targetH = outH - 130;

  const uniformScale = Math.min(targetW / stageW, targetH / stageH);
  const offsetX = 48 + (targetW - stageW * uniformScale) / 2;
  const offsetY = targetTop + (targetH - stageH * uniformScale) / 2;

  for (const item of items) {
    if (item.type === 'image') {
      const cx = offsetX + item.x * uniformScale;
      const cy = offsetY + item.y * uniformScale;
      const drawW = item.w * uniformScale;
      const drawH = item.h * uniformScale;

      const imgEl = await loadImage(item.dataUrl);
      if (imgEl) {
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(cx - drawW / 2, cy - drawH / 2, drawW, drawH, 10);
        ctx.clip();
        ctx.drawImage(imgEl, cx - drawW / 2, cy - drawH / 2, drawW, drawH);
        ctx.restore();
      }
    }
  }

  for (const item of items) {
    if (item.type === 'word') {
      const cx = offsetX + item.x * uniformScale;
      const cy = offsetY + item.y * uniformScale;
      const scaledFont = Math.round(item.fontSize * uniformScale);

      ctx.save();
      ctx.font = `700 ${scaledFont}px Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
      ctx.fillStyle = item.color;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, cx, cy);
      ctx.restore();
    }
  }

  return canvas;
}

function canvasToPdfBlob(canvas) {
  const jpegUrl = canvas.toDataURL('image/jpeg', 0.95);
  const b64 = jpegUrl.split(',')[1];
  const bin = atob(b64);
  const imgBytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) imgBytes[i] = bin.charCodeAt(i);

  const pageW = 842;
  const pageH = 595;
  const chunks = [];
  const offsets = [];
  let byteCount = 0;
  const encoder = new TextEncoder();

  function pushStr(str) {
    const b = encoder.encode(str);
    chunks.push(b);
    byteCount += b.length;
  }
  function pushBytes(b) {
    chunks.push(b);
    byteCount += b.length;
  }
  function startObj(id) {
    offsets[id] = byteCount;
    pushStr(`${id} 0 obj\n`);
  }
  function endObj() {
    pushStr('\nendobj\n');
  }

  pushStr('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n');
  startObj(1);
  pushStr('<< /Type /Catalog /Pages 2 0 R >>');
  endObj();
  startObj(2);
  pushStr('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  endObj();
  startObj(3);
  pushStr(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
  endObj();
  startObj(4);
  pushStr(`<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgBytes.length} >>\nstream\n`);
  pushBytes(imgBytes);
  pushStr('\nendstream');
  endObj();
  const stream = `q\n${pageW} 0 0 ${pageH} 0 0 cm\n/Im0 Do\nQ\n`;
  startObj(5);
  pushStr(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  endObj();

  const xref = byteCount;
  pushStr('xref\n0 6\n0000000000 65535 f \n');
  for (let i = 1; i <= 5; i++) {
    pushStr(String(offsets[i]).padStart(10, '0') + ' 00000 n \n');
  }
  pushStr(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);

  return new Blob(chunks, { type: 'application/pdf' });
}

function getSafeExportFilename(ext) {
  const rawName = (state.room && state.room.name) ? state.room.name : state.currentCode;
  const safe = String(rawName).replace(/[^a-zA-Z0-9_-]/g, '_');
  return `wordcloud-${safe}.${ext}`;
}

exportPngBtn.addEventListener('click', async () => {
  if (!state.room || state.room.status !== 'ended') return;
  const canvas = await renderExportCanvas();
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = getSafeExportFilename('png');
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, 'image/png');
});

exportPdfBtn.addEventListener('click', async () => {
  if (!state.room || state.room.status !== 'ended') return;
  const canvas = await renderExportCanvas();
  const blob = canvasToPdfBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = getSafeExportFilename('pdf');
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

function handleInitialRoute() {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, '');
  const joinMatch = path.match(/^join\/([A-Za-z]{6})$/i);
  if (joinMatch) {
    enterRoom(joinMatch[1].toUpperCase(), false, true);
  } else if (/^[A-Za-z]{6}$/.test(path)) {
    enterRoom(path.toUpperCase(), false, false);
  } else {
    cleanupSubscriptions();
    switchActiveView(homeView);
  }
}

updateAuthUI();
handleInitialRoute();

// ==================== EASTER EGG : KONAMI CODE (CONFETTIS + LOGO TREMPLIN NUMÉRIQUE) ====================
(function setupKonamiEasterEgg() {
  const KONAMI_SEQUENCE = [
    'ArrowUp',
    'ArrowUp',
    'ArrowDown',
    'ArrowDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowLeft',
    'ArrowRight',
    'b',
    'a'
  ];
  let konamiIndex = 0;
  let animFrameId = null;

  const konamiCanvas = document.getElementById('konami-canvas');
  if (!konamiCanvas) return;
  const kCtx = konamiCanvas.getContext('2d');

  const logoImg = new Image();
  if (LOGO_URL) logoImg.src = LOGO_URL;

  window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const expected = KONAMI_SEQUENCE[konamiIndex];

    if (key === expected) {
      konamiIndex++;
      if (konamiIndex === KONAMI_SEQUENCE.length) {
        konamiIndex = 0;
        triggerTremplinConfetti();
      }
    } else {
      konamiIndex = key === KONAMI_SEQUENCE[0] ? 1 : 0;
    }
  });

  function triggerTremplinConfetti() {
    showToast('🎉 Easter Egg activé : Tremplin Numérique !');
    if (animFrameId) cancelAnimationFrame(animFrameId);

    konamiCanvas.width = window.innerWidth;
    konamiCanvas.height = window.innerHeight;
    konamiCanvas.classList.remove('hidden');

    const colors = ['#2563eb', '#38bdf8', '#10b981', '#f59e0b', '#f43f5e', '#8b5cf6', '#ec4899'];
    const particles = [];
    const totalParticles = 150;

    for (let i = 0; i < totalParticles; i++) {
      const isLogo = i % 3 === 0;
      const fromLeft = i % 2 === 0;
      particles.push({
        isLogo,
        x: fromLeft ? Math.random() * (konamiCanvas.width * 0.35) : konamiCanvas.width - Math.random() * (konamiCanvas.width * 0.35),
        y: -30 - Math.random() * 350,
        vx: (Math.random() - 0.5) * 8,
        vy: 2.5 + Math.random() * 5.5,
        size: isLogo ? 36 + Math.random() * 22 : 8 + Math.random() * 10,
        color: colors[i % colors.length],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.14,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 0.05 + Math.random() * 0.07
      });
    }

    const startTime = performance.now();
    const maxDurationMs = 7500;

    function animate(now) {
      const elapsed = now - startTime;
      kCtx.clearRect(0, 0, konamiCanvas.width, konamiCanvas.height);

      let aliveCount = 0;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.wobble += p.wobbleSpeed;
        p.x += p.vx + Math.sin(p.wobble) * 1.4;
        p.y += p.vy;
        p.vy += 0.04;
        p.vx *= 0.992;
        p.rotation += p.vRot;

        if (p.y < konamiCanvas.height + 80) {
          aliveCount++;
        }

        kCtx.save();
        kCtx.translate(p.x, p.y);
        kCtx.rotate(p.rotation);

        if (p.isLogo && logoImg.complete && logoImg.naturalWidth > 0) {
          const r = p.size / 2;
          kCtx.beginPath();
          kCtx.arc(0, 0, r, 0, Math.PI * 2);
          kCtx.closePath();
          kCtx.clip();
          kCtx.drawImage(logoImg, -r, -r, p.size, p.size);
        } else {
          kCtx.fillStyle = p.color;
          kCtx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        }

        kCtx.restore();
      }

      if (aliveCount > 0 && elapsed < maxDurationMs) {
        animFrameId = requestAnimationFrame(animate);
      } else {
        kCtx.clearRect(0, 0, konamiCanvas.width, konamiCanvas.height);
        konamiCanvas.classList.add('hidden');
        animFrameId = null;
      }
    }

    animFrameId = requestAnimationFrame(animate);
  }
})();
