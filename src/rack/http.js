import { KinveyMiddleware } from './middleware';
import regeneratorRuntime from 'regenerator-runtime'; // eslint-disable-line no-unused-vars

export class HttpMiddleware extends KinveyMiddleware {
  constructor(name = 'Kinvey Http Middleware') {
    super(name);
  }

  async handle() {
    throw new Error('http middleware not installed');
  }
}
