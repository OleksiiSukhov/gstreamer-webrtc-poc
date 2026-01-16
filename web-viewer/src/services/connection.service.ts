import { SignalingService } from './signaling.service';
import { Config } from '../viewer/config';
import { Utils } from '../viewer/utils';
import { firstValueFrom, map, Observable, Subject } from 'rxjs';
import { inject, injectable } from 'inversify';
import { TYPES } from '../di/types';

@injectable()
export class ConnectionService {
  private signalingService: SignalingService;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private streamingElement: HTMLVideoElement | null = null;

  private videoStreamSubject = new Subject<MediaStream>();
  private connectedSubject = new Subject<void>();
  private disconnectedSubject = new Subject<void>();
  private dataChannelMessageSubject = new Subject<any>();

  private logSubject = new Subject<{
    message: string;
    category: string;
    data?: any;
  }>();

  public readonly connected$: Observable<void> = this.connectedSubject.asObservable();
  public readonly disconnected$: Observable<void> = this.disconnectedSubject.asObservable();
  public readonly dataChannelMessage$: Observable<any> = this.dataChannelMessageSubject.asObservable();
  public readonly log$: Observable<{
    message: string;
    category: string;
    data?: any;
  }> = this.logSubject.asObservable();

  constructor(@inject(TYPES.SignalingService) signalingService: SignalingService) {
    this.signalingService = signalingService;
  }

  public setStreamingElement(element: HTMLVideoElement) {
    this.streamingElement = element;
  }

  public async connect(): Promise<void> {
    if (!this.streamingElement) {
      console.error('Streaming element should be defined');
      return;
    }

    this.log('Connecting to signaling server...', 'signaling');

    this.signalingService.connect();
    this.setupSocketEventNotifications();

    this.pc = new RTCPeerConnection(Utils.peerConfiguration as RTCConfiguration);
    this.setupWebRTCEventListeners();

    await firstValueFrom(this.signalingService.connected$.pipe(map(() => undefined)));
    this.log('Signaling connected, initiating WebRTC...', 'signaling');

    await this.initializeWebRTC();
  }

  private async initializeWebRTC(): Promise<void> {
    if (!this.streamingElement || !this.pc) {
      return;
    }

    const transceiver = this.pc.addTransceiver('video', { direction: 'recvonly' });
    this.setCodecPrefs(transceiver, Config.webrtc.preferredCodec);
    this.log('Video transceiver added (recvonly)', 'signaling');

    this.dc = this.pc.createDataChannel(Config.webrtc.dataChannelName);
    this.setupDataChannelListeners();
    this.log('Data channel created', 'signaling');

    await this.sendOffer();

    const stream = await firstValueFrom(this.videoStreamSubject);
    this.streamingElement.srcObject = stream;
    this.log('Media stream attached to video element', 'signaling');

    await this.streamingElement.play();
    this.log('Video playback started', 'signaling');
  }

  public async disconnect(): Promise<void> {
    if (this.streamingElement) {
      this.streamingElement.srcObject = null;
    }

    const hasConnection =
      this.pc && (this.pc.connectionState === 'connected' || this.pc.iceConnectionState === 'connected');

    if (hasConnection) {
      this.closeConnection();
      this.disconnectedSubject.next();
    }
  }

  private closeConnection(): void {
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }

    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }

    this.signalingService.disconnect();
    this.log('Connection closed', 'signaling');
  }

  public sendMessage(message: string): void {
    if (!message || !this.isDataChannelReady()) {
      return;
    }
    this.dc!.send(message);
  }

  public sendBinaryData(buffer: ArrayBuffer): void {
    if (!this.isDataChannelReady()) {
      return;
    }
    this.dc!.send(buffer);
  }

  public isDataChannelReady(): boolean {
    return this.dc !== null && this.dc.readyState === 'open';
  }

  private setupSocketEventNotifications(): void {
    this.signalingService.connected$.subscribe((socketId: string) => {
      this.log(`Connected to signaling server (${socketId})`, 'signaling');
    });

    this.signalingService.disconnected$.subscribe((reason: string) => {
      this.log(`Disconnected from signaling: ${reason}`, 'signaling');
    });

    this.signalingService.answer$.subscribe(async (answer: any) => {
      this.log('Received SDP answer', 'signaling');

      const actualAnswer = answer.answer || answer;

      try {
        await this.pc!.setRemoteDescription(new RTCSessionDescription(actualAnswer));
        this.log('Remote description set', 'signaling');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log(`Error setting remote description: ${errorMessage}`, 'signaling');
      }
    });

    this.signalingService.candidate$.subscribe(async ({ candidate }) => {
      if (!candidate) return;

      try {
        if (this.pc!.remoteDescription) {
          await this.pc!.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        this.log(`Error adding ICE candidate: ${errorMessage}`, 'signaling');
      }
    });
  }

  private setupWebRTCEventListeners(): void {
    if (!this.pc) return;

    this.pc.ontrack = (event) => {
      this.log('Received video track', 'signaling');
      const [stream] = event.streams;
      this.videoStreamSubject.next(stream);
    };

    this.pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.signalingService.sendCandidate(event.candidate);
      }
    };

    this.pc.onconnectionstatechange = () => {
      this.log(`Connection state: ${this.pc!.connectionState}`, 'signaling');

      if (this.pc!.connectionState === 'failed') {
        this.handleConnectionFailure();
      }
    };

    this.pc.oniceconnectionstatechange = () => {
      this.log(`ICE state: ${this.pc!.iceConnectionState}`, 'signaling');

      if (this.pc!.iceConnectionState === 'failed') {
        this.handleIceConnectionFailure();
      }
    };
  }

  private setupDataChannelListeners(): void {
    if (!this.dc) return;

    this.dc.onopen = () => {
      this.log('Data channel opened', 'signaling');
      this.connectedSubject.next();
    };

    this.dc.onclose = () => {
      this.log('Data channel closed', 'signaling');
    };

    this.dc.onerror = (error) => {
      this.log(`Data channel error: ${error}`, 'signaling');
    };

    this.dc.onmessage = (e) => {
      this.dataChannelMessageSubject.next(e.data);
    };
  }

  private async sendOffer(): Promise<void> {
    if (!this.pc) return;

    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    this.log('Sending SDP offer', 'signaling');
    this.signalingService.sendOffer(offer);
  }

  private setCodecPrefs(transceiver: RTCRtpTransceiver, codec: string): void {
    const capabilities = RTCRtpSender.getCapabilities('video');
    if (!capabilities) return;

    const { codecs } = capabilities;
    const preferredCodec = codecs.find((c) => c.mimeType === codec);

    if (preferredCodec) {
      const reorderedCodecs = [preferredCodec, ...codecs.filter((c) => c.mimeType !== codec)];
      transceiver.setCodecPreferences(reorderedCodecs);
      this.log(`Codec preference set to ${codec}`, 'signaling');
    }
  }

  private handleConnectionFailure(): void {
    this.log('Connection failed - recovery not implemented', 'signaling');
  }

  private handleIceConnectionFailure(): void {
    this.log('ICE connection failed - recovery not implemented', 'signaling');
  }

  private log(message: string, category: string, data?: any): void {
    this.logSubject.next({ message, category, data });
  }
}
