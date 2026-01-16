import 'reflect-metadata';
import { Utils } from './utils';
import viewerHtmlContent from './viewer.html?raw';
import viewerCssContent from './viewer.css?raw';
import { ConnectionService } from '../services/connection.service';
import { TYPES } from '../di/types';
import { StateStore } from '../services/state-store';
import { container } from '../di/container';

class WebRTCViewer extends HTMLElement {
  private elements: {
    video: HTMLVideoElement;
    connectButton: HTMLButtonElement;
    disconnectButton: HTMLButtonElement;
    testButton: HTMLButtonElement;
  } | null = null;

  private stateStore: StateStore;
  private connectionService: ConnectionService;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    this.stateStore = container.get<StateStore>(TYPES.StateStore);
    this.connectionService = container.get<ConnectionService>(TYPES.ConnectionService);
  }

  static get observedAttributes() {
    return ['signaling-url'];
  }

  attributeChangedCallback(name: string, _oldValue: string, newValue: string) {
    if (name === 'signaling-url') {
      this.stateStore.setSignalingUrl(newValue);
    }
  }

  async connectedCallback() {
    await this.render();
    this.setupElements();
    this.setupEventListeners();
    this.setupConnectionServiceNotifications();

    console.log('[WebRTC Viewer] Ready. Click "Connect" to initiate connection.');
  }

  private async render() {
    this.shadowRoot!.innerHTML = '<div style="padding: 20px; text-align: center;">Loading...</div>';

    try {
      const style = document.createElement('style');
      style.textContent = viewerCssContent;

      const template = document.createElement('template');
      template.innerHTML = viewerHtmlContent;

      this.shadowRoot!.innerHTML = '';
      this.shadowRoot!.appendChild(style);
      this.shadowRoot!.appendChild(template.content.cloneNode(true));
    } catch (error) {
      console.error('Failed to load component resources:', error);
      this.shadowRoot!.innerHTML =
        '<div style="padding: 20px; text-align: center; color: red;">Failed to load component</div>';
    }
  }

  private setupElements() {
    this.elements = {
      video: this.shadowRoot!.getElementById('video') as HTMLVideoElement,
      connectButton: this.shadowRoot!.getElementById('connect-button') as HTMLButtonElement,
      disconnectButton: this.shadowRoot!.getElementById('disconnect-btn') as HTMLButtonElement,
      testButton: this.shadowRoot!.getElementById('test-btn') as HTMLButtonElement
    };
  }

  private setupEventListeners() {
    if (!this.elements) return;

    this.elements.connectButton.addEventListener('click', () => this.connect());
    this.elements.disconnectButton.addEventListener('click', () => this.disconnect());
    this.elements.testButton.addEventListener('click', () => this.sendTestMessage());

    // Video input event listeners
    this.elements.video.addEventListener('keyup', (e: KeyboardEvent) => this.sendKey(e, Utils.keyboardEventType.Up));
    this.elements.video.addEventListener('keydown', (e: KeyboardEvent) => this.sendKey(e, Utils.keyboardEventType.Down));
    this.elements.video.addEventListener('click', (e: MouseEvent) => this.sendMouseEvent(e));
    this.elements.video.addEventListener('mousedown', (e: MouseEvent) => this.sendMouseEvent(e));
    this.elements.video.addEventListener('mouseup', (e: MouseEvent) => this.sendMouseEvent(e));
    this.elements.video.addEventListener('mousemove', (e: MouseEvent) => this.sendMouseEvent(e));
    this.elements.video.addEventListener('wheel', (e: WheelEvent) => this.sendMouseWheel(e), { passive: true });
    this.elements.video.addEventListener('contextmenu', (e: Event) => e.preventDefault());
  }

  private setupConnectionServiceNotifications() {
    this.connectionService.log$.subscribe(({ message, category, data }) => {
      const timestamp = this.getTimestamp();
      const dataStr = data ? ` ${JSON.stringify(data)}` : '';
      console.log(`[${timestamp}] [${category}] ${message}${dataStr}`);
    });

    this.connectionService.connected$.subscribe(() => {
      this.setConnected();
    });

    this.connectionService.disconnected$.subscribe(() => {
      this.setDisconnected();
    });

    this.connectionService.dataChannelMessage$.subscribe((data: any) => {
      if (data instanceof ArrayBuffer) {
        console.log(`[${this.getTimestamp()}] [streamer] Binary message received (${data.byteLength} bytes)`);
        return;
      }

      console.log(`[${this.getTimestamp()}] [streamer] ${data}`);

      if (data === 'ping') {
        this.connectionService.sendMessage('pong');
      }
    });
  }

  private async connect() {
    if (!this.elements) return;
    this.connectionService.setStreamingElement(this.elements.video);
    await this.connectionService.connect();
  }

  private async disconnect() {
    await this.connectionService.disconnect();
  }

  private setConnected() {
    if (!this.elements) return;
    this.elements.connectButton.disabled = true;
    this.elements.disconnectButton.disabled = false;
    this.elements.testButton.disabled = false;
  }

  private setDisconnected() {
    if (!this.elements) return;
    this.elements.connectButton.disabled = false;
    this.elements.disconnectButton.disabled = true;
    this.elements.testButton.disabled = true;
  }

  private sendTestMessage() {
    if (!this.connectionService.isDataChannelReady()) {
      console.log('[Test] Data channel not ready');
      return;
    }

    const testMessage = {
      Name: 'TestMessage',
      Payload: {
        message: 'Hello from viewer!',
        timestamp: Date.now(),
        testData: {
          numbers: [1, 2, 3],
          nested: { key: 'value' }
        }
      }
    };

    console.log(`[${this.getTimestamp()}] [viewer] Sending test command:`, testMessage);

    // Send as binary with type prefix (6 = JSON command)
    const jsonString = JSON.stringify(testMessage);
    const encoder = new TextEncoder();
    const jsonBytes = encoder.encode(jsonString);
    const data = new Uint8Array(1 + jsonBytes.length);
    data[0] = Utils.customInputEvent.Message; // Type 6 = JSON command
    data.set(jsonBytes, 1);

    this.connectionService.sendBinaryData(data.buffer);
  }

  private sendKey(event: KeyboardEvent, type: number) {
    if (!this.connectionService.isDataChannelReady()) return;

    event.preventDefault();

    const key = (Utils.keyMap as Record<string, number>)[event.code] || 0;
    const character = event.key.length === 1 ? event.key.charCodeAt(0) : 0;

    this.connectionService.sendBinaryData(
      new Uint8Array([Utils.customInputEvent.Keyboard, type, event.repeat ? 1 : 0, key, character]).buffer
    );
  }

  private sendMouseEvent(event: MouseEvent) {
    if (!this.elements || !this.connectionService.isDataChannelReady()) return;

    const videoRect = this.elements.video.getBoundingClientRect();
    const x = Math.round(event.clientX - videoRect.left);
    const y = Math.round(event.clientY - videoRect.top);

    const data = new DataView(new ArrayBuffer(6));
    data.setUint8(0, Utils.customInputEvent.Mouse);
    data.setInt16(1, x, true);
    data.setInt16(3, y, true);
    data.setUint8(5, event.buttons);

    this.connectionService.sendBinaryData(data.buffer);
  }

  private sendMouseWheel(event: WheelEvent) {
    if (!this.connectionService.isDataChannelReady()) return;

    const data = new DataView(new ArrayBuffer(9));
    data.setUint8(0, Utils.customInputEvent.MouseWheel);
    data.setFloat32(1, event.deltaX, true);
    data.setFloat32(5, event.deltaY, true);

    this.connectionService.sendBinaryData(data.buffer);
  }

  private getTimestamp(): string {
    const now = new Date();
    return `${now.getUTCHours().toString().padStart(2, '0')}:${now.getUTCMinutes().toString().padStart(2, '0')}:${now.getUTCSeconds().toString().padStart(2, '0')}.${now.getUTCMilliseconds().toString().padStart(3, '0')}`;
  }
}

customElements.define('webrtc-viewer', WebRTCViewer);

export { WebRTCViewer };
