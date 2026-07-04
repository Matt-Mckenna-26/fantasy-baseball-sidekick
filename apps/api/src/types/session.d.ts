import 'express-session';

declare module 'express-session' {
  interface SessionData {
    /** True once the session has a connected Yahoo account. */
    yahooConnected?: boolean;
    /** CSRF state value for the in-flight OAuth authorization request. */
    oauthState?: string;
  }
}
