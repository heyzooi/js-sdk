// Network persistence.
// --------------------

// The cached return value of `deviceInformation` function.
var deviceInformationHeader = null;

// The actual execution of a network request must be defined by an adapter.

/**
 * @private
 * @memberof! <global>
 * @namespace Kinvey.Persistence.Net
 */
Kinvey.Persistence.Net = /** @lends Kinvey.Persistence.Net */{
  /**
   * Initiates a create request.
   *
   * @param {Request} request The request.
   * @param {Options} options Options.
   * @returns {Promise} The response.
   */
  create: function(request, options) {
    // Debug.
    if(KINVEY_DEBUG) {
      log('Initiating a create request.', arguments);
    }

    // Initiate the network request.
    request.method = 'POST';
    return Kinvey.Persistence.Net._request(request, options);
  },

  /**
   * Initiates a read request.
   *
   * @param {Request} request The request.
   * @param {Options} options Options.
   * @returns {Promise} The response.
   */
  read: function(request, options) {
    // Debug.
    if(KINVEY_DEBUG) {
      log('Initiating a read request.', arguments);
    }

    // Cast arguments.
    request.flags = request.flags || {};
    options       = options || {};

    // Add support for file references.
    if(null != request.collection) {
      if(false !== options.fileTls) {
        request.flags.kinveyfile_tls = true;
      }
      if(options.fileTtl) {
        request.flags.kinveyfile_ttl = options.fileTtl;
      }
    }

    // Add support for references.
    if(options.relations) {
      // Resolve all relations not explicitly excluded.
      options.exclude = options.exclude || [];
      var resolve = Object.keys(options.relations).filter(function(member) {
        return -1 === options.exclude.indexOf(member);
      });

      if(0 !== resolve.length) {
        request.flags.retainReferences = false;
        request.flags.resolve          = resolve.join(',');
      }
    }

    // Initiate the network request.
    request.method = 'GET';
    return Kinvey.Persistence.Net._request(request, options);
  },

  /**
   * Initiates an update request.
   *
   * @param {Request} request The request.
   * @param {Options} options Options.
   * @returns {Promise} The response.
   */
  update: function(request, options) {
    // Debug.
    if(KINVEY_DEBUG) {
      log('Initiating an update request.', arguments);
    }

    // Initiate the network request.
    request.method = 'PUT';
    return Kinvey.Persistence.Net._request(request, options);
  },

  /**
   * Initiates a delete request.
   *
   * @param {Request} request The request.
   * @param {Options} options Options.
   * @returns {Promise} The response.
   */
  destroy: function(request, options) {
    // Debug.
    if(KINVEY_DEBUG) {
      log('Initiating a delete request.', arguments);
    }

    // Initiate the network request.
    request.method = 'DELETE';
    return Kinvey.Persistence.Net._request(request, options);
  },

  /**
   * Initiates a network request to the Kinvey service.
   *
   * @private
   * @param {Request} request The request.
   * @param {string} request.method The request method.
   * @param {Options} options Options.
   * @throws {Kinvey.Error} * `request` must contain: `method`.
   *                         * `request` must contain: `namespace`.
   *                         * `request` must contain: `auth`.
   * @returns {Promise}
   */
  _request: function(request, options) {
    // Validate arguments.
    if(null == request.method) {
      throw new Kinvey.Error('request argument must contain: method.');
    }
    if(null == request.namespace) {
      throw new Kinvey.Error('request argument must contain: namespace.');
    }
    if(null == request.auth) {
      throw new Kinvey.Error('request argument must contain: auth.');
    }

    // Validate preconditions.
    var error;
    if(null == Kinvey.appKey && Auth.None !== request.auth) {
      error = clientError(Kinvey.Error.MISSING_APP_CREDENTIALS);
      return Kinvey.Defer.reject(error);
    }
    if(null == Kinvey.masterSecret && options.skipBL) {
      error = clientError(Kinvey.Error.MISSING_MASTER_CREDENTIALS);
      return Kinvey.Defer.reject(error);
    }

    // Cast arguments.
    options.trace = options.trace || (KINVEY_DEBUG && false !== options.trace);

    // Build, escape, and join URL segments.
    // Format: <API_ENDPOINT>/<namespace>[/<Kinvey.appKey>][/<collection>][/<id>]
    var segments = [ request.namespace, Kinvey.appKey, request.collection, request.id];
    segments = segments.filter(function(value) {
      // Exclude empty optional segment. Note the required namespace cannot be
      // empty at this point (enforced above).
      return null != value;
    }).map(Kinvey.Persistence.Net.encode);
    var url = [ Kinvey.API_ENDPOINT ].concat(segments).join('/') + '/';

    // Build query string.
    var flags = request.flags || {};
    if(request.query) {// Add query fragments.
      var query = request.query.toJSON();
      flags.query = query.filter;
      if(null !== query.limit) {
        flags.limit = query.limit;
      }
      if(0 !== query.skip) {
        flags.skip = query.skip;
      }
      if(!isEmpty(query.sort)) {
        flags.sort = query.sort;
      }
    }

    // If `options.nocache`, add a cache busting query string. This is useful
    // for Android < 4.0 which caches all requests aggressively.
    if(options.nocache) {
      flags._ = Math.random().toString(36).substr(2);
    }

    // Format fragments.
    var params = [];
    for(var key in flags) {
      if(flags.hasOwnProperty(key)) {
        var value = isString(flags[key]) ? flags[key] : JSON.stringify(flags[key]);
        params.push(
          Kinvey.Persistence.Net.encode(key) + '=' + Kinvey.Persistence.Net.encode(value)
        );
      }
    }

    // Append query string if there are `params`.
    if(0 < params.length) {
      url += '?' + params.join('&');
    }

    // Evaluate the device information header.
    if(null === deviceInformationHeader) {
      deviceInformationHeader = deviceInformation();
    }

    // Set headers.
    var headers = {
      Accept                        : 'application/json',
      'X-Kinvey-API-Version'        : Kinvey.API_VERSION,
      'X-Kinvey-Device-Information' : deviceInformationHeader
    };

    // Append optional headers.
    if(null != request.data) {
      headers['Content-Type'] = 'application/json; charset=utf-8';
    }
    if(options.contentType) {
      headers['X-Kinvey-Content-Type'] = options.contentType;
    }
    if(options.skipBL) {
      headers['X-Kinvey-Skip-Business-Logic'] = true;
    }
    if(options.trace) {
      headers['X-Kinvey-Include-Headers-In-Response'] = 'X-Kinvey-Request-Id';
      headers['X-Kinvey-ResponseWrapper']             = true;
    }

    // Debug.
    if(KINVEY_DEBUG) {
      headers['X-Kinvey-Trace-Request']               = true;
      headers['X-Kinvey-Force-Debug-Log-Credentials'] = true;
    }

    // Authorization.
    var promise = request.auth().then(function(auth) {
      if(null !== auth) {
        // Format credentials.
        var credentials = auth.credentials;
        if(null != auth.username) {
          credentials = Kinvey.Persistence.Net.base64(auth.username + ':' + auth.password);
        }

        // Append header.
        headers.Authorization = auth.scheme + ' ' + credentials;
      }
    });

    // Invoke the network layer.
    return promise.then(function() {
      var response = Kinvey.Persistence.Net.request(
        request.method,
        url,
        request.data,
        headers,
        options
      ).then(function(response) {
        // Parse the response.
        response = JSON.parse(response);

        // Debug.
        if(KINVEY_DEBUG && options.trace && isObject(response)) {
          log('Obtained the request ID.', response.headers['X-Kinvey-Request-Id']);
        }

        return options.trace && isObject(response) ? response.result : response;
      }, function(response) {
        // Parse the response.
        var requestId = null;
        try {
          response = JSON.parse(response);

          // If `options.trace`, extract result and headers from the response.
          if(options.trace) {
            requestId = response.headers['X-Kinvey-Request-Id'];
            response  = response.result;
          }
        }
        catch(e) { }

        // Format the response as client-side error object.
        if(null != response && null != response.error) {// Server-side error.
          response = {
            name        : response.error,
            description : response.description || '',
            debug       : response.debug       || ''
          };

          // If `options.trace`, add the `requestId`.
          if(options.trace) {
            response.requestId = requestId;

            // Debug.
            if(KINVEY_DEBUG) {
              log('Obtained the request ID.', requestId);
            }
          }
        }
        else {// Client-side error.
          var dict = {// Dictionary for common errors.
            abort   : Kinvey.Error.REQUEST_ABORT_ERROR,
            error   : Kinvey.Error.REQUEST_ERROR,
            timeout : Kinvey.Error.REQUEST_TIMEOUT_ERROR
          };
          response = clientError(dict[response] || dict.error, { debug: response });
        }

        // Reject.
        return Kinvey.Defer.reject(response);
      });

      // Add a descriptive message to `InvalidCredentials` error so the user
      // knows what’s going on.
      return response.then(null, function(error) {
        if(Kinvey.Error.INVALID_CREDENTIALS === error.name) {
          error.debug += ' It is possible the tokens used to execute the ' +
           'request are expired. In that case, please run ' +
           '`Kinvey.User.logout({ force: true })`, and then log back in ' +
           ' using`Kinvey.User.login(username, password)` to solve this issue.';
        }
        return Kinvey.Defer.reject(error);
      });
    });
  },

  /**
   * Base64-encodes a value.
   *
   * @abstract
   * @method
   * @param {string} value Value.
   * @returns {string} Base64-encoded value.
   */
  base64: methodNotImplemented('Kinvey.Persistence.Net.base64'),

  /**
   * Encodes a value for use in the URL.
   *
   * @abstract
   * @method
   * @param {string} value Value.
   * @returns {string} Encoded value.
   */
  encode: methodNotImplemented('Kinvey.Persistence.Net.encode'),

  /**
   * Initiates a network request.
   *
   * @abstract
   * @method
   * @param {string}  method    Method.
   * @param {string}  url       URL.
   * @param {?Object} [body]    Body.
   * @param {Object}  [headers] Headers.
   * @param {Options} [options] Options.
   * @returns {Promise} The promise.
   */
  request: methodNotImplemented('Kinvey.Persistence.Net.request'),

  /**
   * Sets the implementation of `Kinvey.Persistence.Net` to the specified
   * adapter.
   *
   * @method
   * @param {Object} adapter Object implementing the `Kinvey.Persistence.Net`
   *          interface.
   */
  use: use(['base64', 'encode', 'request'])
};