"use strict";

const { createHash, createHmac } = require("node:crypto");
const { sendHttps, webUrl } = require("./academy-provider-https");

const roomDefaults = {
  capacity: 60, emptyTimeout: 300, duration: 90, welcomeMessage: "",
  webcams: true, participantWebcams: false, viewOtherWebcams: true, muteOnStart: true, screenShare: true, participantScreenShare: false,
  waitingRoom: false, chat: true, chatFiles: false, participantList: true, raiseHand: true,
  whiteboard: false, sharedNotes: false, cloudRecording: false, autoRecording: false,
};
const defaults = {
  enabled: false, serverUrl: "", clientUrl: "", apiKey: "", apiSecret: "",
  language: "es-ES", moderator: "Ivanna Saldaña", room: roomDefaults,
};

function createPlugNmeet({ getSettings, RequestError, requireText, id, transport = sendHttps }) {
  const opening = new Map();
  const settings = () => getSettings() || defaults;

  function view() {
    const { apiSecret, namespace, ...fields } = settings();
    return { ...fields, secretSaved: Boolean(apiSecret) };
  }

  function number(value, label, min, max) {
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new RequestError(400, `Indica «${label}» entre ${min} y ${max}.`);
    return value;
  }

  function validate(input) {
    const previous = settings();
    if (typeof input?.enabled !== "boolean") throw new RequestError(400, "Indica si PlugNmeet está habilitado.");
    const serverUrl = webUrl(input.serverUrl, "Servidor de PlugNmeet", { requireText, RequestError }).replace(/\/auth\/?$/i, "").replace(/\/+$/, "");
    const clientUrl = webUrl(input.clientUrl, "Cliente de PlugNmeet", { requireText, RequestError });
    const apiKey = requireText(input.apiKey ?? "", 250, "API key");
    const secretInput = requireText(input.apiSecret ?? "", 500, "API secret");
    if (apiKey && !/^[!-~]+$/.test(apiKey)) throw new RequestError(400, "La API key contiene caracteres no admitidos.");
    if (previous.apiSecret && previous.serverUrl !== serverUrl && !secretInput) {
      throw new RequestError(400, "Vuelve a escribir el API secret al cambiar el servidor.");
    }
    const apiSecret = secretInput || previous.apiSecret;
    if (input.enabled && (!serverUrl || !apiKey || !apiSecret)) throw new RequestError(400, "Completa el servidor, la API key y el API secret.");
    const moderator = requireText(input.moderator ?? defaults.moderator, 90, "Nombre de quien modera", true);
    const language = requireText(input.language ?? defaults.language, 16, "Idioma", true);
    if (!/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(language)) throw new RequestError(400, "Escribe un idioma como es-ES.");
    const values = input.room || {};
    const room = {
      capacity: number(values.capacity ?? roomDefaults.capacity, "capacidad", 0, 2000),
      duration: number(values.duration ?? roomDefaults.duration, "duración en minutos", 0, 1440),
      emptyTimeout: number(values.emptyTimeout ?? roomDefaults.emptyTimeout, "espera sin participantes", 10, 3600),
      welcomeMessage: requireText(values.welcomeMessage ?? "", 400, "Mensaje de bienvenida"),
    };
    for (const [key, initial] of Object.entries(roomDefaults)) {
      if (typeof initial === "boolean") {
        const value = values[key] ?? initial;
        if (typeof value !== "boolean") throw new RequestError(400, "Revisa las opciones de la sala.");
        room[key] = value;
      }
    }
    return { enabled: input.enabled, serverUrl, clientUrl, apiKey, apiSecret, language, moderator, room, namespace: previous.namespace || id() };
  }

  function config(needEnabled = true) {
    const value = settings();
    if ((needEnabled && !value.enabled) || !value.serverUrl || !value.apiKey || !value.apiSecret) {
      throw new RequestError(409, "Configura la conexión con PlugNmeet en Administración.");
    }
    return value;
  }

  async function api(value, action, payload) {
    const body = JSON.stringify(payload);
    const headers = {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      "API-KEY": value.apiKey,
      "HASH-SIGNATURE": createHmac("sha256", value.apiSecret).update(body).digest("hex"),
    };
    let response;
    try { response = await transport(new URL(`${value.serverUrl}/auth/${action}`), { headers, body }); }
    catch { throw new RequestError(502, "No se pudo conectar con el servidor de PlugNmeet."); }
    if (response.status === 401 || response.status === 403) throw new RequestError(502, "PlugNmeet rechazó las credenciales.");
    if (response.status !== 200 || typeof response.result?.status !== "boolean") {
      throw new RequestError(502, "PlugNmeet devolvió una respuesta inesperada.");
    }
    return response.result;
  }

  const roomId = (value, offerId) => `ivanna-${createHash("sha256").update(`${value.namespace}:${offerId}`).digest("hex").slice(0, 24)}`;

  async function active(value, room_id) {
    const result = await api(value, "room/isRoomActive", { room_id });
    if (!result.status || typeof result.is_active !== "boolean") throw new RequestError(502, "PlugNmeet no pudo comprobar el estado de la sala.");
    return result.is_active;
  }

  function roomPayload(room_id, title, room) {
    return {
      room_id,
      max_participants: room.capacity,
      empty_timeout: room.emptyTimeout,
      metadata: {
        room_title: title, welcome_message: room.welcomeMessage,
        room_features: {
          allow_webcams: room.webcams, admin_only_webcams: !room.participantWebcams,
          allow_view_other_webcams: room.viewOtherWebcams, mute_on_start: room.muteOnStart,
          allow_screen_share: room.screenShare, allow_view_other_users_list: room.participantList,
          allow_raise_hand: room.raiseHand, room_duration: room.duration,
          recording_features: {
            is_allow: room.cloudRecording, is_allow_cloud: room.cloudRecording, is_allow_local: false,
            enable_auto_cloud_recording: room.cloudRecording && room.autoRecording, only_record_admin_webcams: true,
          },
          chat_features: { is_allow: room.chat, is_allow_file_upload: room.chat && room.chatFiles },
          whiteboard_features: { is_allow: room.whiteboard }, shared_note_pad_features: { is_allow: room.sharedNotes },
          waiting_room_features: { is_active: room.waitingRoom },
          breakout_room_features: { is_allow: false }, external_media_player_features: { is_allow: false },
          display_external_link_features: { is_allow: false },
        },
        default_lock_settings: { lock_screen_sharing: !room.participantScreenShare },
      },
    };
  }

  async function open(value, room_id, title) {
    const key = `${value.serverUrl}/${room_id}`;
    if (opening.has(key)) return opening.get(key);
    const pending = (async () => {
      if (await active(value, room_id)) return;
      const result = await api(value, "room/create", roomPayload(room_id, title, value.room));
      if (!result.status && !await active(value, room_id)) throw new RequestError(502, "PlugNmeet no pudo abrir la sala.");
    })();
    opening.set(key, pending);
    try { await pending; } finally { opening.delete(key); }
  }

  async function join(offerId, title, member, moderator = false) {
    const value = config();
    const room_id = roomId(value, offerId);
    if (moderator) await open(value, room_id, title);
    else if (!await active(value, room_id)) throw new RequestError(409, "La sala se habilita cuando la moderación abre la clase.");
    const result = await api(value, "room/getJoinToken", {
      room_id,
      user_info: {
        name: moderator ? value.moderator : member.name,
        user_id: `${moderator ? "moderator" : "student"}-${member.id}`,
        is_admin: moderator,
        user_metadata: { preferred_lang: value.language, record_webcam: moderator && value.room.cloudRecording },
      },
    });
    if (settings() !== value) throw new RequestError(409, "Cambió la configuración de la sala. Vuelve a intentar.");
    if (!result.status || typeof result.token !== "string" || !result.token || result.token.length > 6000) {
      throw new RequestError(502, "PlugNmeet no pudo autorizar el ingreso.");
    }
    const url = new URL(value.clientUrl || `${value.serverUrl}/`);
    url.searchParams.set("access_token", result.token);
    return url.href;
  }

  async function status(offerId) {
    const value = config();
    return active(value, roomId(value, offerId));
  }

  async function end(offerId) {
    const value = config();
    const room_id = roomId(value, offerId);
    if (!await active(value, room_id)) return;
    const result = await api(value, "room/end", { room_id });
    if (!result.status && await active(value, room_id)) throw new RequestError(502, "PlugNmeet no pudo cerrar la sala.");
  }

  async function testConnection() {
    const value = config(false);
    await active(value, roomId(value, "test"));
  }

  async function fetchRecordings(value, offerId, from) {
    if (!Number.isSafeInteger(from) || from < 0) throw new RequestError(400, "Elige una página válida.");
    const room_id = roomId(value, offerId);
    const limit = 20;
    const response = await api(value, "recording/fetch", { room_ids: [room_id], from, limit, order_by: "DESC" });
    if (!response.status || !response.result) throw new RequestError(502, "PlugNmeet no pudo consultar las grabaciones.");
    const result = response.result;
    const records = (Array.isArray(result.recordings_list) ? result.recordings_list : [])
      .filter((item) => item.room_id === room_id && typeof item.record_id === "string")
      .map(({ record_id, metadata, file_size, creation_time }) => ({
        id: record_id,
        title: typeof metadata?.title === "string" ? metadata.title.slice(0, 180) : "",
        bytes: Number.isFinite(file_size) ? file_size : 0,
        timestamp: Number.isFinite(creation_time) ? creation_time : null,
      }));
    return { records, next: from + limit < Number(result.total_recordings) ? from + limit : null };
  }

  function recordings(offerId, from) {
    return fetchRecordings(config(false), offerId, from);
  }

  async function download(offerId, recordId, from) {
    const value = config(false);
    const { records } = await fetchRecordings(value, offerId, from);
    if (!records.some(({ id }) => id === recordId)) throw new RequestError(404, "La grabación no pertenece a este vivo.");
    const response = await api(value, "recording/getDownloadToken", { record_id: recordId });
    if (settings() !== value) throw new RequestError(409, "Cambió la configuración de PlugNmeet. Vuelve a intentar.");
    if (!response.status || typeof response.token !== "string" || !response.token || response.token.length > 6000) {
      throw new RequestError(502, "No se pudo preparar la descarga de la grabación.");
    }
    return `${value.serverUrl}/download/recording/${encodeURIComponent(response.token)}`;
  }

  return { view, validate, config, join, status, end, testConnection, recordings, download };
}

module.exports = { createPlugNmeet };
