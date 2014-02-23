'use strict';

/**
 * Properties and settings of the OAuth2 authorization server
 */
exports.properties = {
  username: 'test',
  password: 'test',
  hostname: 'http://localhost:3000',
  login: 'http://localhost:3000/login',
  redirect: 'http://localhost:3000',
  clientId: 'trustedClient',
  clientSecret: 'ssh-otherpassword',
  token: 'http://localhost:3000/oauth2/token',
  authorization: 'http://localhost:3000/oauth2/authorize/decision',
  userinfo: 'http://localhost:3000/api2/me',
  clientinfo: 'http://localhost:3000/api/clientinfo',
  logout: 'http://localhost:3000/logout'
};
