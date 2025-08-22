const WebSocket = require('ws');

class WebSocketManager {
  constructor() {
    this.ws = null;
    this.userId = null;
    this.baseUrl = null;
    this.reconnectTimer = null;
    this.pingTimer = null;
    this.isIntentionalClose = false;
    this.reconnectDelay = 3000;
    this.maxReconnectDelay = 30000;
    this.onMessageCallback = null;
  }

  connect(userId, baseUrl) {
    if (!userId || !baseUrl) {
      console.log('[WebSocketManager] Missing userId or baseUrl');
      return;
    }

    this.userId = userId;
    this.baseUrl = baseUrl;
    this.isIntentionalClose = false;
    
    // Clear any existing connection
    this.disconnect();
    
    // Convert http(s) to ws(s)
    const wsUrl = baseUrl.replace(/^http/, 'ws');
    const url = `${wsUrl}/socket?user_id=${encodeURIComponent(userId)}`;
    
    console.log(`[WebSocketManager] Connecting to ${url}`);
    
    try {
      this.ws = new WebSocket(url);
      
      this.ws.on('open', () => {
        console.log('[WebSocketManager] Connected');
        this.reconnectDelay = 3000; // Reset delay on successful connection
        this.startPing();
        
        // Send initial hello
        this.send({ type: 'hello', user_id: userId });
      });
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          console.log('[WebSocketManager] Received:', message);
          
          if (this.onMessageCallback) {
            this.onMessageCallback(message);
          }
          
          // Handle different message types
          if (message.type === 'notification') {
            // Show notification using Electron's notification API
            const { Notification } = require('electron');
            const notification = new Notification({
              title: message.title || 'Routed',
              body: message.body || '',
              silent: false
            });
            notification.show();
          }
        } catch (e) {
          console.error('[WebSocketManager] Error parsing message:', e);
        }
      });
      
      this.ws.on('close', (code, reason) => {
        console.log(`[WebSocketManager] Disconnected - code: ${code}, reason: ${reason}`);
        this.stopPing();
        
        if (!this.isIntentionalClose) {
          this.scheduleReconnect();
        }
      });
      
      this.ws.on('error', (error) => {
        console.error('[WebSocketManager] Error:', error.message);
      });
      
      this.ws.on('pong', () => {
        // Server responded to ping, connection is healthy
      });
      
    } catch (error) {
      console.error('[WebSocketManager] Connection failed:', error);
      this.scheduleReconnect();
    }
  }
  
  disconnect() {
    this.isIntentionalClose = true;
    this.stopPing();
    
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    
    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {
        console.error('[WebSocketManager] Error closing connection:', e);
      }
      this.ws = null;
    }
  }
  
  send(data) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        const message = typeof data === 'string' ? data : JSON.stringify(data);
        this.ws.send(message);
        return true;
      } catch (e) {
        console.error('[WebSocketManager] Send error:', e);
        return false;
      }
    }
    return false;
  }
  
  startPing() {
    this.stopPing();
    // Send ping every 25 seconds to keep connection alive
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.ping();
        } catch (e) {
          console.error('[WebSocketManager] Ping error:', e);
        }
      }
    }, 25000);
  }
  
  stopPing() {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }
  
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return; // Already scheduled
    }
    
    console.log(`[WebSocketManager] Reconnecting in ${this.reconnectDelay}ms...`);
    
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      
      if (this.userId && this.baseUrl) {
        this.connect(this.userId, this.baseUrl);
      }
      
      // Exponential backoff
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
    }, this.reconnectDelay);
  }
  
  onMessage(callback) {
    this.onMessageCallback = callback;
  }
  
  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

module.exports = { WebSocketManager };
