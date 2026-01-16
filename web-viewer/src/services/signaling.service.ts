import { io, Socket } from 'socket.io-client';
import { Config } from '../viewer/config';
import { Observable, Subject } from 'rxjs';
import { inject, injectable } from 'inversify';
import { StateStore } from './state-store';
import { TYPES } from '../di/types';

@injectable()
export class SignalingService {
  private stateStore: StateStore;
  private socket: Socket | null = null;

  private connectSubject = new Subject<string>();
  private disconnectSubject = new Subject<string>();
  private answerSubject = new Subject<any>();
  private candidateSubject = new Subject<{ candidate: any }>();

  public readonly connected$: Observable<string> = this.connectSubject.asObservable();
  public readonly disconnected$: Observable<string> = this.disconnectSubject.asObservable();
  public readonly answer$: Observable<any> = this.answerSubject.asObservable();
  public readonly candidate$: Observable<{ candidate: any }> = this.candidateSubject.asObservable();

  constructor(@inject(TYPES.StateStore) stateStore: StateStore) {
    this.stateStore = stateStore;
  }

  public connect(): void {
    const url = this.stateStore.state.signalingUrl || Config.signalingUrl;
    console.log(`[Signaling] Connecting to ${url}...`);

    this.socket = io(url);

    this.socket.emit('register', { role: 'viewer' });

    this.socket.on('connect', () => {
      this.connectSubject.next(this.socket!.id || '');
    });

    this.socket.on('disconnect', (reason: string) => {
      this.disconnectSubject.next(reason);
    });

    this.socket.on('answer', (answer: any) => {
      this.answerSubject.next(answer);
    });

    this.socket.on('candidate', (data: { candidate: any }) => {
      this.candidateSubject.next(data);
    });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }

  public sendOffer(offer: RTCSessionDescriptionInit): void {
    this.socket?.emit('offer', { offer });
  }

  public sendCandidate(candidate: RTCIceCandidate): void {
    this.socket?.emit('candidate', { to: 'renderer', candidate });
  }
}
