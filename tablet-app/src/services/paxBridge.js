/**
 * paxBridge.js — BroadPOS US ECR protocol implementation.
 *
 * Protocol: [STX][LenL][LenH][Payload][ETX][LRC]
 *   - STX = 0x02
 *   - LenL/LenH = 2-byte length of payload (little-endian)
 *   - Payload = pipe-delimited ASCII: T00|1.28|01|amount|tipReq|ecrRef|...
 *   - ETX = 0x03
 *   - LRC = XOR of bytes from LenL through ETX (inclusive)
 *
 * Native: uses TcpSocket plugin (real TCP to BroadPOS port 10009)
 * Web: simulated with random approve/decline
 */

import { Capacitor, registerPlugin } from '@capacitor/core';
import { getJSON, setJSON } from './storage';

let TcpSocket = null;
let PosLinkPayment = null;
function getTcpSocket() {
  if (!TcpSocket && Capacitor.isNativePlatform()) {
    TcpSocket = registerPlugin('TcpSocket');
  }
  return TcpSocket;
}

function getPosLinkPayment() {
  if (!PosLinkPayment && Capacitor.isNativePlatform()) {
    PosLinkPayment = registerPlugin('PosLinkPayment');
  }
  return PosLinkPayment;
}

const CONFIG_KEY = 'vido_pax_config';

const DEFAULT_CONFIG = {
  connectionMode: 'tcp',
  terminalSerial: '',
  ip: '',
  port: 10009,
  timeout: 60000,
  ecrId: '01',
  protocol: 'broadpos',  // 'broadpos' | 'json'  ← user can switch
  protocolVersion: '1.28',
  separator: '|',         // some variants use 0x1C, most use '|'
  useLengthPrefix: false,
  lengthEndian: 'little',  // 'little' | 'big' when length prefix is enabled
  useLRC: true,
  tipRequest: false,
  maxRetries: 3,
  usePosLinkSdk: true,
};

export const PAX_STATUS = {
  IDLE:         { id: 'idle',         label: 'Idle',                  color: '#6B7280' },
  SENDING:      { id: 'sending',      label: 'Sending to card terminal...', color: '#3B82F6' },
  WAITING_CARD: { id: 'waiting_card', label: 'Waiting for card',      color: '#FCD34D' },
  READING:      { id: 'reading',      label: 'Reading card',          color: '#3B82F6' },
  WAITING_TIP:  { id: 'waiting_tip',  label: 'Customer choosing tip', color: '#FCD34D' },
  PROCESSING:   { id: 'processing',   label: 'Processing...',         color: '#3B82F6' },
  APPROVED:     { id: 'approved',     label: 'Approved',              color: '#4ADE80' },
  DECLINED:     { id: 'declined',     label: 'Declined',              color: '#EF4444' },
  CANCELLED:    { id: 'cancelled',    label: 'Cancelled',             color: '#9CA3AF' },
  TIMEOUT:      { id: 'timeout',      label: 'Timeout',               color: '#EF4444' },
  ERROR:        { id: 'error',        label: 'Error',                 color: '#EF4444' },
};

export const formatUSD = (n) => '$' + (Math.round(n * 100) / 100).toFixed(2);

// =====================================================================
// BYTE / BASE64 HELPERS
// =====================================================================
function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(b64) {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function asciiToBytes(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function bytesToAscii(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

function bytesToReadable(bytes) {
  // Show printable ASCII as char, others as <HH>
  let s = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x02) s += '<STX>';
    else if (b === 0x03) s += '<ETX>';
    else if (b === 0x1C) s += '<FS>';
    else if (b === 0x0A) s += '<LF>';
    else if (b === 0x0D) s += '<CR>';
    else if (b >= 0x20 && b <= 0x7E) s += String.fromCharCode(b);
    else s += '<' + b.toString(16).padStart(2, '0').toUpperCase() + '>';
  }
  return s;
}

// =====================================================================
// BROADPOS US PROTOCOL FRAMING
// =====================================================================

/**
 * Build a BroadPOS frame: [STX][LenL][LenH][Payload][ETX][LRC]
 * @param {string} payload — ASCII payload like "T00|1.28|01|1000|0|0001"
 */
function buildFrame(payload, opts) {
  const payloadBytes = asciiToBytes(payload);
  const useLength = opts.useLengthPrefix !== false;
  const useLRC = opts.useLRC !== false;

  const len = payloadBytes.length;
  const extraHead = useLength ? 3 : 1;   // STX + (LenL + LenH) or just STX
  const extraTail = useLRC ? 2 : 1;       // ETX + LRC or just ETX

  const out = new Uint8Array(extraHead + payloadBytes.length + extraTail);
  let p = 0;
  out[p++] = 0x02; // STX
  if (useLength) {
    if (opts.lengthEndian === 'big') {
      out[p++] = (len >> 8) & 0xff; // LenH
      out[p++] = len & 0xff;        // LenL
    } else {
      out[p++] = len & 0xff;        // LenL
      out[p++] = (len >> 8) & 0xff; // LenH
    }
  }
  for (let i = 0; i < payloadBytes.length; i++) out[p++] = payloadBytes[i];
  out[p++] = 0x03; // ETX

  if (useLRC) {
    // LRC = XOR of bytes from LenL through ETX (or after STX through ETX if no length)
    let lrc = 0;
    const start = 1;                       // skip STX
    const end = p;                         // up to and including ETX
    for (let i = start; i < end; i++) lrc ^= out[i];
    out[p++] = lrc;
  }
  return out;
}

/**
 * Parse a BroadPOS response frame, return payload string (pipe-delimited).
 */
function parseFrame(bytes, opts) {
  if (bytes.length < 3) throw new Error('Frame too short');
  if (bytes[0] !== 0x02) throw new Error('No STX at start: got 0x' + bytes[0].toString(16));
  const useLength = opts.useLengthPrefix !== false;
  const useLRC = opts.useLRC !== false;

  let start = 1;
  if (useLength) {
    // Skip length bytes (we don't strictly verify here)
    start = 3;
  }
  // Find ETX
  let etxIdx = -1;
  for (let i = start; i < bytes.length; i++) {
    if (bytes[i] === 0x03) { etxIdx = i; break; }
  }
  if (etxIdx === -1) throw new Error('No ETX in response');

  const payloadBytes = bytes.slice(start, etxIdx);
  return bytesToAscii(payloadBytes);
}

// =====================================================================
// DEBUG LOG
// =====================================================================
const MAX_LOG = 50;
let debugLog = [];

function logEvent(type, msg, bytes) {
  const entry = {
    time: new Date().toISOString(),
    type,            // 'tx', 'rx', 'info', 'error'
    message: msg,
    hex: bytes ? bytesToHex(bytes) : null,
    ascii: bytes ? bytesToReadable(bytes) : null,
    length: bytes ? bytes.length : null,
  };
  debugLog.unshift(entry);
  if (debugLog.length > MAX_LOG) debugLog.length = MAX_LOG;
  // Also console for native debugging via Logcat / DevTools
  try {
    console.log('[PAYMENT]', type.toUpperCase(), msg, entry.hex ? `(${entry.length} bytes) ${entry.ascii}` : '');
  } catch {}
}

export function getDebugLog() {
  return debugLog.slice();
}

export function clearDebugLog() {
  debugLog = [];
}

// =====================================================================
// PAX SERVICE
// =====================================================================
class PaxService {
  constructor() {
    this.config = { ...DEFAULT_CONFIG };
    this.connected = false;
    this.socketId = null;
    this.listeners = [];
    this.currentTxn = null;
    this.isNative = Capacitor.isNativePlatform();
    this._ecrCounter = 1;
    this.ready = this._loadConfig();
  }

  async _loadConfig() {
    const saved = await getJSON(CONFIG_KEY, null);
    if (saved) this.config = { ...DEFAULT_CONFIG, ...saved };
  }

  async updateConfig(cfg) {
    await this.ready;
    this.config = { ...this.config, ...cfg };
    await setJSON(CONFIG_KEY, this.config);
  }

  onUpdate(cb) {
    this.listeners.push(cb);
    return () => { this.listeners = this.listeners.filter(l => l !== cb); };
  }

  _emit() {
    this.listeners.forEach(cb => { try { cb(this.currentTxn); } catch {} });
  }

  _setStatus(status, extra = {}) {
    this.currentTxn = { ...(this.currentTxn || {}), status, ...extra };
    this._emit();
  }

  reset() {
    this.currentTxn = null;
    this._emit();
  }

  _nextEcrRef() {
    const n = this._ecrCounter++;
    return String(n).padStart(6, '0');
  }

  // ==========================================================================
  // PUBLIC API
  // ==========================================================================
  async ping() {
    await this.ready;
    if (!this.isNative) {
      if (this.config.connectionMode !== 'tcp' || this.config.ip) {
        await this._delay(400);
        this.connected = true;
        return { ok: true, model: 'Card terminal (web simulated)', web: true };
      }
      return { ok: false, error: 'Enter payment terminal IP first (web mock)' };
    }
    if ((this.config.connectionMode || 'tcp') === 'tcp' && !this.config.ip) {
      return { ok: false, error: 'Payment terminal IP not configured' };
    }

    try {
      const poslink = getPosLinkPayment();
      if (poslink && this.config.usePosLinkSdk !== false) {
        try {
          const init = await poslink.init();
          logEvent('info', `POSLink SDK ready: ${init.sdk || 'Android SDK'}`);
          if ((this.config.connectionMode || 'tcp') !== 'tcp') {
            this.connected = true;
            return { ok: true, model: `POSLink ${this.config.connectionMode.toUpperCase()} connection` };
          }
        } catch (sdkError) {
          logEvent('error', 'POSLink SDK init failed: ' + sdkError.message);
        }
      }
      logEvent('info', `Connecting to ${this.config.ip}:${this.config.port}`);
      const id = await this._connect(this.config.ip, this.config.port, 5000);
      await this._close(id);
      this.connected = true;
      logEvent('info', 'Connect test OK');
      return { ok: true, model: 'BroadPOS card terminal', ip: this.config.ip };
    } catch (e) {
      this.connected = false;
      logEvent('error', 'Connect failed: ' + e.message);
      return { ok: false, error: e.message || 'Connection failed' };
    }
  }

  async sale(amount, refNum) {
    await this.ready;
    this.currentTxn = { amount, refNum: refNum || this._nextEcrRef(), status: PAX_STATUS.SENDING };
    this._emit();

    if (!this.isNative) return this._simulateSale(amount, this.currentTxn.refNum);
    return this._realSale(amount, this.currentTxn.refNum);
  }

  async testSale() {
    return this.sale(0.01, this._nextEcrRef());
  }

  async cancel() {
    if (!this.isNative) {
      this._setStatus(PAX_STATUS.CANCELLED);
      return;
    }
    if (this.socketId) {
      try { await this._close(this.socketId); } catch {}
      this.socketId = null;
    }
    this._setStatus(PAX_STATUS.CANCELLED);
  }

  // ==========================================================================
  // WEB SIMULATION
  // ==========================================================================
  _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

  async _simulateSale(amount, refNum) {
    try {
      await this._delay(800);
      this._setStatus(PAX_STATUS.WAITING_CARD);
      await this._delay(1500);
      this._setStatus(PAX_STATUS.READING);
      await this._delay(800);
      this._setStatus(PAX_STATUS.WAITING_TIP);
      await this._delay(2000);
      this._setStatus(PAX_STATUS.PROCESSING);
      await this._delay(1200);

      const approved = Math.random() > 0.1;
      if (approved) {
        const tipPct = [0, 0.15, 0.18, 0.20, 0.25][Math.floor(Math.random() * 5)];
        const tipAmount = Math.round(amount * tipPct * 100) / 100;
        const result = {
          status: PAX_STATUS.APPROVED,
          authCode: 'WEB' + Math.floor(Math.random() * 900000 + 100000),
          cardLast4: ['4242', '4444', '1881', '0005'][Math.floor(Math.random() * 4)],
          cardType: ['Visa', 'Mastercard', 'Amex', 'Discover'][Math.floor(Math.random() * 4)],
          tipAmount,
          totalCharged: amount + tipAmount,
          refNum,
          web: true,
        };
        this._setStatus(PAX_STATUS.APPROVED, result);
        return result;
      } else {
        const result = {
          status: PAX_STATUS.DECLINED,
          declineReason: 'Insufficient funds (web mock)',
          refNum,
        };
        this._setStatus(PAX_STATUS.DECLINED, result);
        return result;
      }
    } catch (e) {
      this._setStatus(PAX_STATUS.ERROR, { error: e.message });
      throw e;
    }
  }

  // ==========================================================================
  // REAL BROADPOS SALE
  // ==========================================================================
  async _realSale(amount, refNum) {
    if (this.config.usePosLinkSdk !== false) {
      try {
        return await this._posLinkSdkSale(amount, refNum);
      } catch (e) {
        logEvent('error', 'POSLink SDK transaction failed: ' + e.message);
        throw e;
      }
    }

    const cents = Math.round(amount * 100);
    const sep = this.config.separator || '|';

    // BroadPOS US Sale (T00) payload — standard field order:
    // Command | Version | TransType | Amount | TipRequest | ECRRefNum | ...
    // Most fields after ECRRefNum are optional (empty string).
    const fields = [
      'T00',                              // Command
      this.config.protocolVersion || '1.28', // Version
      '01',                                // TransType: 01 = SALE
      String(cents),                       // Amount in cents
      this.config.tipRequest === false ? '0' : '1', // TipRequest: 1 lets PAX prompt for tip
      refNum,                              // ECRRefNum (trace number)
      '',                                  // OrigRefNum (for void/refund)
      '',                                  // AuthCode (for force/post)
      '',                                  // ExtData
    ];
    const payload = fields.join(sep);

    let txFrame, response;
    try {
      // Build request frame
      txFrame = buildFrame(payload, this.config);
      logEvent('tx', `Sale $${amount} ref=${refNum}`, txFrame);

      // Connect + send
      this.socketId = await this._connect(this.config.ip, this.config.port, 5000);
      this._setStatus(PAX_STATUS.WAITING_CARD);

      // Send request and read response. BroadPOS can send NAK on a bad/checksum
      // read; retry the exact same frame before giving up.
      const responseBytes = await this._sendRequestWithRetry(this.socketId, txFrame);
      logEvent('rx', `Got response (${responseBytes.length} bytes)`, responseBytes);
      try {
        await this._sendBytes(this.socketId, new Uint8Array([0x06]));
        logEvent('tx', 'ACK response to card terminal', new Uint8Array([0x06]));
      } catch (ackError) {
        logEvent('error', 'Could not ACK card terminal response: ' + ackError.message);
      }

      // Close socket
      await this._close(this.socketId);
      this.socketId = null;

      // Parse
      const payloadStr = parseFrame(responseBytes, this.config);
      logEvent('info', 'Parsed payload: ' + payloadStr);
      response = payloadStr.split(sep);
    } catch (e) {
      const message = e.message?.includes('before STX')
        ? 'Card terminal closed connection before response. Try preset: No Length Prefix + LRC, and turn Ask Tip off. Also confirm ECR/BroadPOS is enabled on the terminal.'
        : e.message;
      logEvent('error', 'Transaction failed: ' + message);
      if (this.socketId) {
        try { await this._close(this.socketId); } catch {}
        this.socketId = null;
      }
      const status = message?.includes('timeout') || message?.includes('SocketTimeout')
        ? PAX_STATUS.TIMEOUT : PAX_STATUS.ERROR;
      this._setStatus(status, { error: message });
      throw new Error(message);
    }

    // Parse BroadPOS response — typical R00 fields:
    // [0] R00 (echo command)
    // [1] Version
    // [2] ResponseCode  (000000 = approved)
    // [3] ResponseMessage
    // [4] AuthCode
    // [5] HostRefNum / RetrievalRefNum
    // [6] AmountApproved (cents)
    // [7] AmountAuthorized
    // [8] TipAmount (cents)
    // [9] CardType
    // [10] MaskedCardNum (ends with last 4)
    // [11] ECRRefNum
    // ...

    const responseCode = response[2] || '';
    const approved = responseCode === '000000' || responseCode === '000';

    if (approved) {
      const tipCents = parseInt(response[8] || '0', 10) || 0;
      const approvedCents = parseInt(response[6] || String(Math.round(amount * 100)), 10);
      const maskedCard = response[10] || '';
      const last4Match = maskedCard.match(/(\d{4})\s*$/);
      const result = {
        status: PAX_STATUS.APPROVED,
        authCode: response[4] || '',
        cardLast4: last4Match ? last4Match[1] : '',
        cardType: response[9] || '',
        tipAmount: tipCents / 100,
        totalCharged: approvedCents / 100,
        refNum,
        responseCode,
        raw: response,
      };
      this._setStatus(PAX_STATUS.APPROVED, result);
      return result;
    } else {
      const result = {
        status: PAX_STATUS.DECLINED,
        declineReason: response[3] || `Code: ${responseCode}`,
        responseCode,
        refNum,
        raw: response,
      };
      this._setStatus(PAX_STATUS.DECLINED, result);
      return result;
    }
  }

  async _posLinkSdkSale(amount, refNum) {
    const plugin = getPosLinkPayment();
    if (!plugin) throw new Error('POSLinkPayment plugin not available');
    const connectionMode = this.config.connectionMode || 'tcp';
    if (connectionMode === 'tcp' && !this.config.ip) throw new Error('Payment terminal IP not configured');
    if (connectionMode === 'serial') {
      throw new Error('Serial number pairing is not enabled in this build yet. Use TCP/IP or USB.');
    }

    logEvent('tx', `POSLink SDK sale $${amount} ref=${refNum}`);
    this._setStatus(PAX_STATUS.WAITING_CARD);

    const response = await plugin.sale({
      amount,
      refNum,
      connectionMode,
      host: this.config.ip,
      port: this.config.port || 10009,
      timeout: this.config.timeout || 60000,
      terminalSerial: this.config.terminalSerial || '',
      tipAmount: '',
      extData: '',
    });

    logEvent('rx', 'POSLink SDK response: ' + JSON.stringify(response));

    if (!response.ok) {
      const message = response.processMessage || 'POSLink SDK transaction failed';
      this._setStatus(PAX_STATUS.ERROR, { error: message, raw: response });
      throw new Error(message);
    }

    if (response.approved) {
      const approvedCents = parseInt(response.approvedAmount || response.requestedAmount || '0', 10) || Math.round(amount * 100);
      const maskedCard = response.maskedCard || '';
      const last4Match = maskedCard.match(/(\d{4})\s*$/);
      const result = {
        status: PAX_STATUS.APPROVED,
        authCode: response.authCode || '',
        cardLast4: last4Match ? last4Match[1] : '',
        cardType: response.cardType || '',
        tipAmount: 0,
        totalCharged: approvedCents / 100,
        refNum: response.refNum || refNum,
        responseCode: response.resultCode || '',
        raw: response,
        processor: 'poslink_sdk',
      };
      this._setStatus(PAX_STATUS.APPROVED, result);
      return result;
    }

    const result = {
      status: PAX_STATUS.DECLINED,
      declineReason: response.resultText || response.message || response.hostResponse || `Code: ${response.resultCode || 'unknown'}`,
      responseCode: response.resultCode || '',
      refNum: response.refNum || refNum,
      raw: response,
      processor: 'poslink_sdk',
    };
    this._setStatus(PAX_STATUS.DECLINED, result);
    return result;
  }

  // ==========================================================================
  // TCP HELPERS
  // ==========================================================================
  async _connect(host, port, timeout) {
    const plugin = getTcpSocket();
    if (!plugin) throw new Error('TcpSocket plugin not available');
    const res = await plugin.connect({ host, port, timeout });
    return res.socketId;
  }

  async _sendBytes(socketId, bytes) {
    const plugin = getTcpSocket();
    const b64 = bytesToBase64(bytes);
    return plugin.send({ socketId, data: b64 });
  }

  async _readFrame(socketId, timeout) {
    const plugin = getTcpSocket();
    const res = await plugin.readFrame({
      socketId,
      timeout,
      useLRC: this.config.useLRC !== false,
    });
    if (res.skippedAck) logEvent('info', `Skipped ${res.skippedAck} ACK byte(s) before response`);
    return base64ToBytes(res.data);
  }

  async _sendRequestWithRetry(socketId, txFrame) {
    const maxRetries = Math.max(1, parseInt(this.config.maxRetries || 3, 10));
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      await this._sendBytes(socketId, txFrame);
      if (attempt > 1) logEvent('tx', `Retry request ${attempt}/${maxRetries}`, txFrame);
      try {
        return await this._readFrame(socketId, this.config.timeout);
      } catch (e) {
        lastError = e;
        if (!String(e.message || '').includes('NAK') || attempt === maxRetries) {
          throw e;
        }
        logEvent('error', `Terminal returned NAK, retrying request ${attempt + 1}/${maxRetries}`);
      }
    }
    throw lastError || new Error('No response from card terminal');
  }

  async _close(socketId) {
    const plugin = getTcpSocket();
    return plugin.close({ socketId });
  }
}

export const paxService = new PaxService();
