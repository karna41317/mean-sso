/**
 * Module dependencies.
 */
var mongoose = require('mongoose'),
  oauth2orize = require('oauth2orize'),
  config = require('./config'),
  uid = require('../helpers/uid'),
  User = mongoose.model('User'),
// TODO: convert the following models to Mongoose or REDIS
  clients = require('../app/models/client'),
  accessTokens = require('../app/models/access-token'),
  refreshTokens = require('../app/models/refresh-token'),
  authorizationCodes = require('../app/models/authorization-code'),
  querystring = require('querystring');

module.exports = function (passport) {

// create OAuth 2.0 server
  var server = oauth2orize.createServer();

// Register supported grant types.
//
// OAuth 2.0 specifies a framework that allows users to grant client
// applications limited access to their protected resources.  It does this
// through a process of the user granting access, and the client exchanging
// the grant for an access token.

  /**
   * Grant authorization codes
   *
   * The callback takes the `client` requesting authorization, the `redirectURI`
   * (which is used as a verifier in the subsequent exchange), the authenticated
   * `user` granting access, and their response, which contains approved scope,
   * duration, etc. as parsed by the application.  The application issues a code,
   * which is bound to these values, and will be exchanged for an access token.
   */
  server.grant(oauth2orize.grant.code(function (client, redirectURI, user, ares, done) {
    var code = uid.uid(config.token.authorizationCodeLength);
    authorizationCodes.save(code, client.id, redirectURI, user.id, client.scope, function (err) {
      if (err) {
        return done(err);
      }
      return done(null, code);
    });
  }));

  /**
   * Grant implicit authorization.
   *
   * The callback takes the `client` requesting authorization, the authenticated
   * `user` granting access, and their response, which contains approved scope,
   * duration, etc. as parsed by the application.  The application issues a token,
   * which is bound to these values.
   */
  server.grant(oauth2orize.grant.token(function (client, user, ares, done) {
    var token = uid.uid(config.token.accessTokenLength);
    accessTokens.save(token, config.token.calculateExpirationDate(), user.id, client.id, client.scope, function (err) {
      if (err) {
        return done(err);
      }
      return done(null, token, {expires_in: config.token.expiresIn});
    });
  }));

  /**
   * Exchange authorization codes for access tokens.
   *
   * The callback accepts the `client`, which is exchanging `code` and any
   * `redirectURI` from the authorization request for verification.  If these values
   * are validated, the application issues an access token on behalf of the user who
   * authorized the code.
   */
  server.exchange(oauth2orize.exchange.code(function (client, code, redirectURI, done) {
    authorizationCodes.find(code, function (err, authCode) {
      if (err) {
        return done(err);
      }
      if (!authCode) {
        return done(null, false);
      }
      if (client.id !== authCode.clientID) {
        return done(null, false);
      }
      if (redirectURI !== authCode.redirectURI) {
        return done(null, false);
      }
      authorizationCodes.delete(code, function (err, result) {
        if (err) {
          return done(err);
        }
        if (result != undefined && result === 0) {
          //This condition can result because of a "race condition" that can occur naturally when you're making
          //two very fast calls to the authorization server to exchange authorization codes.  So, we check for
          // the result and if it's not undefined and the result is zero, then we have already deleted the
          // authorization code
          return done(null, false);
        }
        var token = uid.uid(config.token.accessTokenLength);
        accessTokens.save(token, config.token.calculateExpirationDate(), authCode.userID, authCode.clientID, authCode.scope, function (err) {
          if (err) {
            return done(err);
          }
          var refreshToken = null;
          //I mimic openid connect's offline scope to determine if we send
          //a refresh token or not
          if (authCode.scope && authCode.scope.indexOf("offline_access") === 0) {
            refreshToken = uid.uid(config.token.refreshTokenLength);
            refreshTokens.save(refreshToken, authCode.userID, authCode.clientID, authCode.scope, function (err) {
              if (err) {
                return done(err);
              }
              return done(null, token, refreshToken, {expires_in: config.token.expiresIn});
            });
          } else {
            return done(null, token, refreshToken, {expires_in: config.token.expiresIn});
          }
        });
      });
    });
  }));

  /**
   * Exchange user id and password for access tokens.
   *
   * The callback accepts the `client`, which is exchanging the user's name and password
   * from the token request for verification. If these values are validated, the
   * application issues an access token on behalf of the user who authorized the code.
   */
  server.exchange(oauth2orize.exchange.password(function (client, username, password, scope, done) {
    //Validate the user
    User.findOne({
      username: username
    }, function (err, user) {
      if (err) {
        return done(err);
      }
      if (!user) {
        return done(null, false);
      }
      if (password !== user.password) {
        return done(null, false);
      }
      var token = uid.uid(config.token.accessTokenLength);
      accessTokens.save(token, config.token.calculateExpirationDate(), user.id, client.id, scope, function (err) {
        if (err) {
          return done(err);
        }
        var refreshToken = null;
        //I mimic openid connect's offline scope to determine if we send
        //a refresh token or not
        if (scope && scope.indexOf("offline_access") === 0) {
          refreshToken = uid.uid(config.token.refreshTokenLength);
          refreshTokens.save(refreshToken, user.id, client.id, scope, function (err) {
            if (err) {
              return done(err);
            }
            return done(null, token, refreshToken, {expires_in: config.token.expiresIn});
          });
        } else {
          return done(null, token, refreshToken, {expires_in: config.token.expiresIn});
        }
      });
    });
  }));

  /**
   * Exchange the client id and password/secret for an access token.
   *
   * The callback accepts the `client`, which is exchanging the client's id and
   * password/secret from the token request for verification. If these values are validated, the
   * application issues an access token on behalf of the client who authorized the code.
   */
  server.exchange(oauth2orize.exchange.clientCredentials(function (client, scope, done) {
    var token = uid.uid(config.token.accessTokenLength);
    //Pass in a null for user id since there is no user when using this grant type
    accessTokens.save(token, config.token.calculateExpirationDate(), null, client.id, scope, function (err) {
      if (err) {
        return done(err);
      }
      return done(null, token, null, {expires_in: config.token.expiresIn});
    });
  }));

  /**
   * Exchange the refresh token for an access token.
   *
   * The callback accepts the `client`, which is exchanging the client's id from the token
   * request for verification.  If this value is validated, the application issues an access
   * token on behalf of the client who authorized the code
   */
  server.exchange(oauth2orize.exchange.refreshToken(function (client, refreshToken, scope, done) {
    refreshTokens.find(refreshToken, function (err, authCode) {
      if (err) {
        return done(err);
      }
      if (!authCode) {
        return done(null, false);
      }
      if (client.id !== authCode.clientID) {
        return done(null, false);
      }
      var token = uid.uid(config.token.accessTokenLength);
      accessTokens.save(token, config.token.calculateExpirationDate(), authCode.userID, authCode.clientID, authCode.scope, function (err) {
        if (err) {
          return done(err);
        }
        return done(null, token, null, {expires_in: config.token.expiresIn});
      });
    });
  }));

  /**
   * User authorization endpoint
   *
   * `authorization` middleware accepts a `validate` callback which is
   * responsible for validating the client making the authorization request.  In
   * doing so, is recommended that the `redirectURI` be checked against a
   * registered value, although security requirements may vary accross
   * implementations.  Once validated, the `done` callback must be invoked with
   * a `client` instance, as well as the `redirectURI` to which the user will be
   * redirected after an authorization decision is obtained.
   *
   * This middleware simply initializes a new authorization transaction.  It is
   * the application's responsibility to authenticate the user and render a dialog
   * to obtain their approval (displaying details about the client requesting
   * authorization).  We accomplish that here by routing through `ensureLoggedIn()`
   * first, and rendering the `dialog` view.
   */
  var _authorization = [
      function(req, res, next) { // default used by CAS clients
          if (!req.query['response_type']) {
              req.query['response_type'] = 'code';
          }
          next();
      },
      server.authorization(function (clientID, redirectURI, scope, done) {
      clients.findByClientId(clientID, function (err, client) {
        if (err) {
          return done(err);
        }
        if (client) {
          client.scope = scope;
        }
        // WARNING: For security purposes, it is highly advisable to check that
        //          redirectURI provided by the client matches one registered with
        //          the server.  For simplicity, this example does not.  You have
        //          been warned.
        return done(null, client, redirectURI);
      });
    }),
    function (req, res, next) {
      //Render the decision dialog if the client isn't a trusted client
      //TODO Make a mechanism so that if this isn't a trusted client, the user can recorded that they have consented
      //but also make a mechanism so that if the user revokes access to any of the clients then they will have to
      //re-consent.
      clients.findByClientId(req.query.client_id, function (err, client) {
        if (!err && client && client.trustedClient && client.trustedClient === true) {
          //This is how we short call the decision like the dialog below does
          server.decision({loadTransaction: false}, function (req, callback) {
            callback(null, { allow: true });
          })(req, res, next);
        } else {
          res.render('dialog', { transactionID: req.oauth2.transactionID, user: req.user, myclient: req.oauth2.client });
        }
      });
    }
  ];

  /**
   * User decision endpoint
   *
   * `decision` middleware processes a user's decision to allow or deny access
   * requested by a client application.  Based on the grant type requested by the
   * client, the above grant middleware configured above will be invoked to send
   * a response.
   */
  var _decision = [
    server.decision()
  ];

  /**
   * Token endpoint
   *
   * `token` middleware handles client requests to exchange authorization grants
   * for access tokens.  Based on the grant type being exchanged, the above
   * exchange middleware will be invoked to handle the request.  Clients must
   * authenticate when making requests to this endpoint.
   */
  var _token = [
    function(req, res, next) { // default used by CAS clients
      Object.keys(req.query).forEach(function (val) {
        req.body[val] = req.query[val];
      });
      if (!req.body['grant_type']) {
        req.body['grant_type'] = 'authorization_code';
      }
      next();
    },
    passport.authenticate(['basic', 'oauth2-client-password'], { session: false }),
    server.token(),
    server.errorHandler()
  ];

    /**
     * Special version of token formats results as form url for CAS clients
     * @type {Array}
     * @private
     */
    var _formToken = [
        function(req, res, next) { // default used by CAS clients
            Object.keys(req.query).forEach(function (val) {
                req.body[val] = req.query[val];
            });
            if (!req.body['grant_type']) {
                req.body['grant_type'] = 'authorization_code';
            }
            next();
        },
        passport.authenticate(['basic', 'oauth2-client-password'], { session: false }),
        function(req, res, next) {
            var myRes = {
                setHeader: function(arg1, arg2) {
                    if (arg1 =='Content-Type') {
                        arg2 = 'application/x-www-form-urlencoded';
                    }
                    res.setHeader(arg1, arg2);
                },
                end: function (arg1) {
                    var formData = querystring.stringify(JSON.parse(arg1));
                    res.end(formData);
                }
            };
            server.token()(req, myRes, next);
        },
        server.errorHandler()
    ];

// Register serialialization and deserialization functions.
//
// When a client redirects a user to user authorization endpoint, an
// authorization transaction is initiated.  To complete the transaction, the
// user must authenticate and approve the authorization request.  Because this
// may involve multiple HTTPS request/response exchanges, the transaction is
// stored in the session.
//
// An application must supply serialization functions, which determine how the
// client object is serialized into the session.  Typically this will be a
// simple matter of serializing the client's ID, and deserializing by finding
// the client by ID from the database.

  server.serializeClient(function (client, done) {
    return done(null, client.id);
  });

  server.deserializeClient(function (id, done) {
    clients.find(id, function (err, client) {
      if (err) {
        return done(err);
      }
      return done(null, client);
    });
  });

  return {
    authorization: _authorization,
    decision: _decision,
    token: _token,
    formToken: _formToken
  };
}
