import httpRequest from 'request';
import Promise from 'es6-promise';
import os from 'os';
import { Middleware } from '../core/request';
import { isDefined } from '../core/utils';
import { NetworkConnectionError, TimeoutError } from '../core/errors';

function deviceInformation(pkg) {
  const platform = process.title;
  const { version } = process;
  const manufacturer = process.platform;

  // Return the device information string.
  const parts = [`js-${pkg.name}/${pkg.version}`];

  return parts.concat([platform, version, manufacturer]).map((part) => {
    if (part) {
      return part.toString().replace(/\s/g, '_').toLowerCase();
    }

    return 'unknown';
  }).join(' ');
}

function deviceInformation2(pkg) {
  return {
    hv: 1,
    os: os.platform(),
    ov: os.release(),
    sdk: pkg.name,
    pv: os.release()
  };
}

export class NodeHttpMiddleware extends Middleware {
  constructor(pkg) {
    super();
    this.pkg = pkg;
  }

  handle(request) {
    const promise = new Promise((resolve, reject) => {
      const {
        url,
        method,
        headers,
        body,
        timeout,
        followRedirect
      } = request;
      const kinveyUrlRegex = /kinvey\.com/gm;

      if (kinveyUrlRegex.test(url)) {
        // Add the X-Kinvey-Device-Information header
        headers['X-Kinvey-Device-Information'] = deviceInformation(this.pkg);
        headers['X-Kinvey-Device-Info'] = JSON.stringify(deviceInformation2(this.pkg));
      }

      httpRequest({
        method: method,
        url: url,
        headers: headers,
        body: body,
        followRedirect: followRedirect,
        timeout: timeout
      }, (error, response, body) => {
        if (isDefined(response) === false) {
          if (error.code === 'ESOCKETTIMEDOUT' || error.code === 'ETIMEDOUT') {
            return reject(new TimeoutError('The network request timed out.'));
          } else if (error.code === 'ENOENT') {
            return reject(new NetworkConnectionError('You do not have a network connection.'));
          }

          return reject(error);
        }

        return resolve({
          response: {
            statusCode: response.statusCode,
            headers: response.headers,
            data: body
          }
        });
      });
    });
    return promise;
  }

  cancel() {
    return Promise.resolve();
  }
}
