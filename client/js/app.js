
const SERVER_URL = (typeof SCREW_CONFIG !== 'undefined' ? SCREW_CONFIG.SERVER_URL : null) || 'http://localhost:8080';
const DB_NAME    = 'screw-identity';
const DB_VERSION = 1;
const STORE      = 'keys';

let _publicKey           = null;
let _privateKey          = null;
let _signPubKey          = null;
let _signPrivKey         = null;
let _address             = null;


let _deviceId            = null;   // device UUID (localStorage)
let _authToken           = null;   // JWT (localStorage)

// ─── WebSocket ───────────────────────────────────────────────────────────────
let _ws                  = null;
let _wsReconnectTimer    = null;

let _seenIds             = new Set();
let _pollInterval        = null;
let _allMessages         = [];
let _activeConvId        = null;
let _lastServerTimestamp = 0;
let _unreadCounts        = {};
let _newContactsCount    = 0;
let _titleBlinkInterval  = null;
let _editContactIdx      = null;
let _drafts              = {};   // { conversation_id → text }
let _reactions           = {};   // { message_id → { emoji → [addr, ...] } }
let _chatPageSize        = 20;


