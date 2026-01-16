import { injectable } from 'inversify';
import { BehaviorSubject } from 'rxjs';

export interface State {
  signalingUrl: string;
}

@injectable()
export class StateStore {
  private _state$: BehaviorSubject<State>;

  constructor() {
    this._state$ = new BehaviorSubject<State>({
      signalingUrl: ''
    });
  }

  public get state$() {
    return this._state$.asObservable();
  }

  get state() {
    return this._state$.getValue();
  }

  public setSignalingUrl(url: string) {
    this._state$.next({ ...this._state$.getValue(), signalingUrl: url });
  }
}
