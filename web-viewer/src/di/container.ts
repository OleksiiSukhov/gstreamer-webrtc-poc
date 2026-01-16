import { Container } from 'inversify';
import { TYPES } from './types';
import { StateStore } from '../services/state-store';
import { ConnectionService } from '../services/connection.service';
import { SignalingService } from '../services/signaling.service';

const container = new Container();

container.bind(TYPES.StateStore).to(StateStore).inSingletonScope();
container.bind(TYPES.ConnectionService).to(ConnectionService).inSingletonScope();
container.bind(TYPES.SignalingService).to(SignalingService).inSingletonScope();

export { container };
