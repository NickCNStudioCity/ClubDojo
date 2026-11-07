// WebSocket connection to the World Server with request/reply and event subscriptions.
(function () {
  class Connection {
    constructor() {
      this.ws = null;
      this.rid = 0;
      this.pending = new Map();
      this.listeners = new Map();
    }

    static normalizeAddress(input) {
      let a = String(input || '').trim();
      if (!a) return null;
      a = a.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
      if (!/:\d+$/.test(a)) a += `:${ClubDojoProtocol.DEFAULT_PORT}`;
      return `ws://${a}`;
    }

    connect(address, timeoutMs = 5000) {
      const url = Connection.normalizeAddress(address);
      if (!url) return Promise.reject(new Error('Enter the host address, for example 192.168.1.20:7777.'));
      this.close();
      return new Promise((resolve, reject) => {
        let settled = false;
        const ws = new WebSocket(url);
        this.ws = ws;
        const timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          ws.close();
          reject(new Error(`No answer from ${url.slice(5)}. Check the address, that the server is running, and the host firewall.`));
        }, timeoutMs);
        ws.onopen = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(); } };
        ws.onerror = () => {
          if (!settled) { settled = true; clearTimeout(timer); reject(new Error(`Could not reach ${url.slice(5)}. Is the ClubDojo server running there?`)); }
        };
        ws.onclose = (ev) => {
          for (const p of this.pending.values()) p.reject(new Error('Connection closed.'));
          this.pending.clear();
          if (this.ws === ws) { this.ws = null; this.emit('_close', { code: ev.code, reason: ev.reason }); }
        };
        ws.onmessage = (ev) => {
          let m;
          try { m = JSON.parse(ev.data); } catch { return; }
          if (m.t === 'reply') {
            const p = this.pending.get(m.rid);
            if (!p) return;
            this.pending.delete(m.rid);
            if (m.ok) p.resolve(m.data || {});
            else p.reject(Object.assign(new Error(m.error || 'Request failed.'), { code: m.code }));
            return;
          }
          this.emit(m.t, m);
        };
      });
    }

    get open() { return !!this.ws && this.ws.readyState === 1; }

    request(t, body = {}) {
      if (!this.open) return Promise.reject(new Error('Not connected.'));
      const rid = ++this.rid;
      return new Promise((resolve, reject) => {
        this.pending.set(rid, { resolve, reject });
        this.ws.send(JSON.stringify({ t, rid, ...body }));
      });
    }

    on(t, fn) {
      if (!this.listeners.has(t)) this.listeners.set(t, new Set());
      this.listeners.get(t).add(fn);
      return () => this.listeners.get(t).delete(fn);
    }

    emit(t, m) {
      for (const fn of this.listeners.get(t) || []) {
        try { fn(m); } catch (e) { console.error(e); }
      }
      for (const fn of this.listeners.get('*') || []) {
        try { fn(m); } catch (e) { console.error(e); }
      }
    }

    close() {
      if (this.ws) {
        const ws = this.ws;
        this.ws = null;
        ws.close();
      }
    }
  }

  window.ClubDojoConnection = Connection;
})();
